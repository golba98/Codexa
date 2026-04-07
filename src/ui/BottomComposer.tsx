import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useFocus, useInput, useStdin } from "ink";
import type { ModelSpec } from "../core/modelSpecs.js";
import type { UIState } from "../session/types.js";
import { truncateEnd } from "./displayText.js";
import { FOCUS_IDS } from "./focus.js";
import {
  createInputViewport,
  deleteInputBackward,
  deleteInputForward,
  getComposerBodyWidth,
  insertInputText,
  moveCursorLeft,
  moveCursorRight,
  normalizeInputText,
  normalizeCursorOffset,
} from "./inputBuffer.js";
import { useTheme } from "./theme.js";
import { clampVisualText, type Layout } from "./layout.js";
import { getTextWidth, splitTextAtColumn } from "./textLayout.js";

type ComposerPersona = "idle" | "busy" | "answer" | "error";
type DeleteIntent = "backspace" | "delete";

const BRACKETED_PASTE_START = /(?:\u001B)?\[200~/;
const BRACKETED_PASTE_END = /(?:\u001B)?\[201~/;
const DELETE_ESCAPE_SEQUENCE = /^\u001b\[3(?:;\d+)?~$/;
const MAX_VISIBLE_INPUT_ROWS = 5;

function resolveDeleteIntentFromRawInput(raw: string): DeleteIntent | null {
  if (raw === "\b" || raw === "\x08" || raw === "\u007f" || raw === "\u001b\u007f") {
    return "backspace";
  }

  if (DELETE_ESCAPE_SEQUENCE.test(raw)) {
    return "delete";
  }

  return null;
}

interface BottomComposerProps {
  layout: Layout;
  uiState: UIState;
  inputEpoch?: number;
  value: string;
  cursor: number;
  onChangeInput: (value: string, cursor: number) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onHistoryUp: () => void;
  onHistoryDown: () => void;
  onTranscriptUp: () => void;
  onTranscriptDown: () => void;
  onQuit: () => void;
}

export function getComposerPersona(uiState: UIState): ComposerPersona {
  if (uiState.kind === "THINKING" || uiState.kind === "RESPONDING" || uiState.kind === "SHELL_RUNNING") {
    return "busy";
  }
  if (uiState.kind === "AWAITING_USER_ACTION") {
    return "answer";
  }
  if (uiState.kind === "ERROR") {
    return "error";
  }
  return "idle";
}

function getPlaceholder(persona: ComposerPersona): string {
  switch (persona) {
    case "answer":
      return "Type your answer...";
    case "error":
      return "Ask again or use /command";
    case "busy":
      return "";
    case "idle":
    default:
      return "Ask Codexa, run !shell, or use /command";
  }
}

export function BottomComposer({
  layout,
  uiState,
  inputEpoch = 0,
  value,
  cursor,
  onChangeInput,
  onSubmit,
  onCancel,
  onHistoryUp,
  onHistoryDown,
  onTranscriptUp,
  onTranscriptDown,
  onQuit,
}: BottomComposerProps) {
  const { stdin } = useStdin();
  const theme = useTheme();
  const { isFocused } = useFocus({ id: FOCUS_IDS.composer, autoFocus: true });
  const [cursorVisible, setCursorVisible] = useState(true);
  const [scrollRow, setScrollRow] = useState(0);
  const persona = getComposerPersona(uiState);
  const inputLocked = persona === "busy";
  const allowHistory = persona === "idle" || persona === "error";
  const promptPrefix = "❯ ";
  const composerWidth = layout.shellWidth;
  const promptWidth = Math.max(10, composerWidth - 20); // Width inside the box
  const valueRef = useRef(value);
  const cursorRef = useRef(cursor);
  const lastPropsValueRef = useRef(value);
  const lastPropsCursorRef = useRef(cursor);
  const pasteBufferRef = useRef<string | null>(null);
  const deleteIntentRef = useRef<DeleteIntent | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setCursorVisible((visible) => !visible), 520);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isFocused) return;

    const handleScrollUp = () => onTranscriptUp();
    const handleScrollDown = () => onTranscriptDown();

    process.stdin.on("codexa-scroll-up", handleScrollUp);
    process.stdin.on("codexa-scroll-down", handleScrollDown);

    const handleRawInput = (chunk: Buffer | string) => {
      const raw = typeof chunk === "string" ? chunk : chunk.toString();
      const intent = resolveDeleteIntentFromRawInput(raw);
      if (intent) deleteIntentRef.current = intent;
    };

    stdin.on("data", handleRawInput);
    return () => {
      process.stdin.off("codexa-scroll-up", handleScrollUp);
      process.stdin.off("codexa-scroll-down", handleScrollDown);
      stdin.off("data", handleRawInput);
    };
  }, [isFocused, stdin, onTranscriptUp, onTranscriptDown]);

  useEffect(() => {
    if (value !== lastPropsValueRef.current || cursor !== lastPropsCursorRef.current) {
      valueRef.current = value;
      cursorRef.current = cursor;
      lastPropsValueRef.current = value;
      lastPropsCursorRef.current = cursor;
    }
  }, [cursor, value]);

  const promptViewport = useMemo(
    () => createInputViewport({
      text: value,
      cursorOffset: normalizeCursorOffset(value, cursor),
      width: promptWidth,
      maxVisibleRows: MAX_VISIBLE_INPUT_ROWS,
      scrollRow,
    }),
    [cursor, promptWidth, scrollRow, value],
  );

  const placeholderText = clampVisualText(getPlaceholder(persona), Math.max(1, promptWidth - 1));

  const commitInputChange = (nextValue: string, nextCursor: number) => {
    const normalizedValue = normalizeInputText(nextValue);
    const normalizedCursor = normalizeCursorOffset(normalizedValue, nextCursor);
    valueRef.current = normalizedValue;
    cursorRef.current = normalizedCursor;
    onChangeInput(normalizedValue, normalizedCursor);
  };

  const insertText = (text: string) => {
    if (!text) return;
    const next = insertInputText({
      value: valueRef.current,
      cursorOffset: cursorRef.current,
      text,
    });
    commitInputChange(next.value, next.cursorOffset);
  };

  const handlePastedInput = (chunk: string) => {
    let remaining = chunk;

    while (remaining.length > 0) {
      if (pasteBufferRef.current !== null) {
        const endMatch = BRACKETED_PASTE_END.exec(remaining);
        if (!endMatch) {
          pasteBufferRef.current += remaining;
          return;
        }

        pasteBufferRef.current += remaining.slice(0, endMatch.index);
        const pastedText = normalizeInputText(pasteBufferRef.current);
        pasteBufferRef.current = null;
        insertText(pastedText);
        remaining = remaining.slice(endMatch.index + endMatch[0].length);
        continue;
      }

      const startMatch = BRACKETED_PASTE_START.exec(remaining);
      if (!startMatch) {
        insertText(normalizeInputText(remaining));
        return;
      }

      const prefix = remaining.slice(0, startMatch.index);
      if (prefix) {
        insertText(normalizeInputText(prefix));
      }

      pasteBufferRef.current = "";
      remaining = remaining.slice(startMatch.index + startMatch[0].length);
    }
  };

  useInput((input, key) => {
    if (key.ctrl && (input === "q" || input === "c")) {
      onQuit();
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }

    if (inputLocked) return;

    if (key.upArrow && allowHistory) {
      onHistoryUp();
      return;
    }

    if (key.downArrow && allowHistory) {
      onHistoryDown();
      return;
    }

    if (key.return) {
      if (!value.trim()) return;
      onSubmit();
      return;
    }

    if (key.leftArrow) {
      const nextCursor = moveCursorLeft(valueRef.current, cursorRef.current);
      commitInputChange(valueRef.current, nextCursor);
      return;
    }

    if (key.rightArrow) {
      const nextCursor = moveCursorRight(valueRef.current, cursorRef.current);
      commitInputChange(valueRef.current, nextCursor);
      return;
    }

    if (key.backspace || input === "\b" || (input === "\u007f" && !key.delete)) {
      deleteIntentRef.current = null;
      const next = deleteInputBackward({
        value: valueRef.current,
        cursorOffset: cursorRef.current,
      });
      commitInputChange(next.value, next.cursorOffset);
      return;
    }

    if (key.delete || (input === "\u007f" && key.delete)) {
      const deleteIntent = deleteIntentRef.current;
      deleteIntentRef.current = null;

      if (deleteIntent === "backspace") {
        const next = deleteInputBackward({
          value: valueRef.current,
          cursorOffset: cursorRef.current,
        });
        commitInputChange(next.value, next.cursorOffset);
        return;
      }

      const next = deleteInputForward({
        value: valueRef.current,
        cursorOffset: cursorRef.current,
      });
      commitInputChange(next.value, next.cursorOffset);
      return;
    }

    if (!key.ctrl && !key.meta && !key.escape && input && input.length > 0 && input !== "\u007f" && input !== "\b") {
      handlePastedInput(input);
    }
  }, { isActive: isFocused });

  const label = persona === "answer" ? "ANSWER AGENT" : "CODEXA AGENT";
  const labelColor = persona === "answer" ? theme.WARNING : theme.TEXT;

  return (
    <Box 
      flexDirection="column" 
      width="100%" 
      borderStyle="round" 
      borderColor={isFocused ? theme.BORDER_ACTIVE : theme.BORDER}
      paddingX={1}
      marginBottom={0}
    >
      <Box flexDirection="row" width="100%" marginBottom={0}>
        <Box width={16} flexShrink={0}>
          <Text color={labelColor} bold>{label}</Text>
        </Box>
        
        <Box flexDirection="column" flexGrow={1}>
          {value.length === 0 && !inputLocked ? (
            <Box width="100%" overflow="hidden">
              <Text color={theme.PROMPT} bold>{promptPrefix}</Text>
              <Text backgroundColor={cursorVisible ? theme.TEXT : undefined} color={cursorVisible ? theme.PANEL : undefined}>{" "}</Text>
              <Text color={theme.DIM}>{placeholderText}</Text>
            </Box>
          ) : inputLocked ? (
            <Box width="100%" overflow="hidden">
              <Text color={theme.PROMPT} bold>{promptPrefix}</Text>
              <Text color={theme.DIM}>{" Busy..."}</Text>
            </Box>
          ) : (
            promptViewport.visibleRows.map((row, index) => {
              const visibleCursorRow = promptViewport.cursorRow - promptViewport.scrollRow;
              const isCursorRow = index === visibleCursorRow;
              const segments = isCursorRow
                ? splitTextAtColumn(row.text, promptViewport.cursorColumn)
                : null;

              return (
                <Box key={index} width="100%" overflow="hidden">
                  <Text color={theme.PROMPT} bold>{index === 0 ? promptPrefix : "  "}</Text>
                  {isCursorRow && segments ? (
                    <>
                      <Text color={theme.TEXT}>{segments.before}</Text>
                      <Text backgroundColor={cursorVisible ? theme.TEXT : undefined} color={cursorVisible ? theme.PANEL : undefined}>
                        {segments.current || " "}
                      </Text>
                      <Text color={theme.TEXT}>{segments.after}</Text>
                    </>
                  ) : (
                    <Text color={theme.TEXT}>{row.text || " "}</Text>
                  )}
                </Box>
              );
            })
          )}
        </Box>
      </Box>
    </Box>
  );
}

