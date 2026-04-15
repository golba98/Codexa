import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useFocus, useInput, useStdin } from "ink";
import type { FocusTargetId } from "./focus.js";
import { useTheme } from "./theme.js";
import { createTerminalInputParser } from "./terminalInputParser.js";

interface TextEntryPanelProps {
  focusId: FocusTargetId;
  title: string;
  subtitle: string;
  placeholder?: string;
  initialValue?: string;
  inputLabel?: string;
  footerHint?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

function insertAt(value: string, index: number, text: string): string {
  return value.slice(0, index) + text + value.slice(index);
}

function consumeQueuedInput(queueRef: React.MutableRefObject<string>, input: string): boolean {
  const queue = queueRef.current;
  if (!queue || !input || !queue.startsWith(input)) {
    return false;
  }

  queueRef.current = queue.slice(input.length);
  return true;
}

export function TextEntryPanel({
  focusId,
  title,
  subtitle,
  placeholder = "",
  initialValue = "",
  inputLabel = "Input",
  footerHint = "Enter submit  Esc cancel  Backspace delete",
  onSubmit,
  onCancel,
}: TextEntryPanelProps) {
  const { stdin } = useStdin();
  const theme = useTheme();
  const { isFocused } = useFocus({ id: focusId, autoFocus: true });
  const [value, setValue] = useState(initialValue);
  const [cursor, setCursor] = useState(initialValue.length);
  const valueRef = useRef(initialValue);
  const cursorRef = useRef(initialValue.length);
  const parserRef = useRef(createTerminalInputParser());
  const approvedTextRef = useRef("");
  const suppressedTextRef = useRef("");

  const commitInputChange = useCallback((nextValue: string, nextCursor: number) => {
    valueRef.current = nextValue;
    cursorRef.current = nextCursor;
    setValue(nextValue);
    setCursor(nextCursor);
  }, []);

  const insertText = useCallback((text: string) => {
    if (!text) {
      return;
    }

    commitInputChange(
      insertAt(valueRef.current, cursorRef.current, text),
      cursorRef.current + text.length,
    );
  }, [commitInputChange]);

  useEffect(() => {
    valueRef.current = value;
    cursorRef.current = cursor;
  }, [cursor, value]);

  useEffect(() => {
    if (!isFocused) {
      parserRef.current.reset();
      approvedTextRef.current = "";
      suppressedTextRef.current = "";
      return;
    }

    const handleRawInput = (chunk: Buffer | string) => {
      const raw = typeof chunk === "string" ? chunk : chunk.toString();
      const events = parserRef.current.push(raw);

      for (const event of events) {
        if (event.type === "text") {
          approvedTextRef.current += event.text;
          continue;
        }

        if (event.type === "paste") {
          insertText(event.text);
          suppressedTextRef.current += event.text;
          continue;
        }

        if (event.leakedText) {
          suppressedTextRef.current += event.leakedText;
        }
      }
    };

    stdin.on("data", handleRawInput);
    return () => {
      stdin.off("data", handleRawInput);
      parserRef.current.reset();
      approvedTextRef.current = "";
      suppressedTextRef.current = "";
    };
  }, [insertText, isFocused, stdin]);

  useInput((input, key) => {
    if (key.escape) {
      parserRef.current.clearPendingSequence();
      onCancel();
      return;
    }

    if (key.return) {
      onSubmit(value.trim());
      return;
    }

    if (key.leftArrow) {
      commitInputChange(valueRef.current, Math.max(0, cursorRef.current - 1));
      return;
    }

    if (key.rightArrow) {
      commitInputChange(valueRef.current, Math.min(valueRef.current.length, cursorRef.current + 1));
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorRef.current === 0) return;
      commitInputChange(
        valueRef.current.slice(0, cursorRef.current - 1) + valueRef.current.slice(cursorRef.current),
        Math.max(0, cursorRef.current - 1),
      );
      return;
    }

    if (!input || key.ctrl || key.meta) {
      return;
    }

    if (consumeQueuedInput(suppressedTextRef, input)) {
      return;
    }

    if (!consumeQueuedInput(approvedTextRef, input)) {
      return;
    }

    insertText(input);
  }, { isActive: isFocused });

  const display = useMemo(() => {
    if (!value) {
      return {
        before: "",
        current: placeholder || " ",
        after: "",
        isPlaceholder: true,
      };
    }

    const safeCursor = Math.max(0, Math.min(cursor, value.length));
    return {
      before: value.slice(0, safeCursor),
      current: value[safeCursor] ?? " ",
      after: value.slice(safeCursor + (safeCursor < value.length ? 1 : 0)),
      isPlaceholder: false,
    };
  }, [cursor, placeholder, value]);

  return (
    <Box flexDirection="column" width="100%" marginTop={1}>
      <Box
        borderStyle="round"
        borderColor={theme.BORDER_SUBTLE}
        paddingX={2}
        paddingY={1}
        width="100%"
      >
        <Text color={theme.ACCENT} bold>{title}  </Text>
        <Text color={theme.MUTED}>{subtitle}</Text>
      </Box>

      <Box
        borderStyle="round"
        borderColor={theme.BORDER_ACTIVE}
        paddingX={2}
        paddingY={1}
        marginTop={1}
        width="100%"
        flexDirection="column"
      >
        <Box>
          <Text color={theme.TEXT}>{inputLabel}: </Text>
          <Text color={display.isPlaceholder ? theme.DIM : theme.TEXT}>{display.before}</Text>
          <Text
            backgroundColor={theme.TEXT}
            color={theme.PANEL}
          >
            {display.current}
          </Text>
          <Text color={display.isPlaceholder ? theme.DIM : theme.TEXT}>{display.after}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.DIM}>{footerHint}</Text>
        </Box>
      </Box>
    </Box>
  );
}

export function measureTextEntryPanelRows(): number {
  return 13;
}
