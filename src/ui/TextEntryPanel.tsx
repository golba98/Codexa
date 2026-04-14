import React, { useMemo, useState } from "react";
import { Box, Text, useFocus, useInput } from "ink";
import type { FocusTargetId } from "./focus.js";
import { useTheme } from "./theme.js";

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
  const theme = useTheme();
  const { isFocused } = useFocus({ id: focusId, autoFocus: true });
  const [value, setValue] = useState(initialValue);
  const [cursor, setCursor] = useState(initialValue.length);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      onSubmit(value.trim());
      return;
    }

    if (key.leftArrow) {
      setCursor((current) => Math.max(0, current - 1));
      return;
    }

    if (key.rightArrow) {
      setCursor((current) => Math.min(value.length, current + 1));
      return;
    }

    if (key.backspace || key.delete) {
      if (cursor === 0) return;
      setValue((current) => current.slice(0, cursor - 1) + current.slice(cursor));
      setCursor((current) => Math.max(0, current - 1));
      return;
    }

    if (!input || key.ctrl || key.meta) {
      return;
    }

    setValue((current) => insertAt(current, cursor, input));
    setCursor((current) => current + input.length);
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
