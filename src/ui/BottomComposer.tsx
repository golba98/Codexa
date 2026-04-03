import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useFocus, useInput } from "ink";
import { formatModeLabel } from "../config/settings.js";
import type { ModelSpec } from "../core/modelSpecs.js";
import type { UIState } from "../session/types.js";
import { FOCUS_IDS } from "./focus.js";
import {
  createInputViewport,
  deleteInputBackward,
  getComposerBodyWidth,
  insertInputText,
  moveCursorLeft,
  moveCursorRight,
  normalizeInputText,
  normalizeCursorOffset,
} from "./inputBuffer.js";
import { getModeColor } from "./modeColor.js";
import { useTheme } from "./theme.js";
import { clampVisualText, getShellWidth, type Layout } from "./layout.js";
import { getTextWidth, splitTextAtColumn } from "./textLayout.js";

type ComposerPersona = "idle" | "busy" | "answer" | "error";

const BRACKETED_PASTE_START = /(?:\u001B)?\[200~/;
const BRACKETED_PASTE_END = /(?:\u001B)?\[201~/;
const MAX_VISIBLE_INPUT_ROWS = 5;

function formatApprox(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

export function getTokenBarDisplay(tokensUsed: number, modelSpec: ModelSpec) {
  if (modelSpec.status !== "verified") {
    return { usedText: `~${formatApprox(tokensUsed)}`, limitText: "unknown", percentage: null as number | null };
  }
  const pct = modelSpec.contextWindow > 0
    ? Math.min(100, Math.round((tokensUsed / modelSpec.contextWindow) * 100))
    : 0;
  return { usedText: `~${formatApprox(tokensUsed)}`, limitText: modelSpec.contextWindow.toLocaleString("en-US"), percentage: pct };
}

interface BottomComposerProps {
  layout: Layout;
  uiState: UIState;
  mode?: string;
  model?: string;
  reasoningLevel?: string;
  tokensUsed?: number;
  modelSpec?: ModelSpec;
  value: string;
  cursor: number;
  onChangeInput: (value: string, cursor: number) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onChangeValue: (value: string) => void;
  onChangeCursor: (cursor: number) => void;
  onHistoryUp: () => void;
  onHistoryDown: () => void;
  onOpenBackendPicker: () => void;
  onOpenModelPicker: () => void;
  onOpenModePicker: () => void;
  onOpenThemePicker: () => void;
  onOpenAuthPanel: () => void;
  onClear: () => void;
  onCycleMode: () => void;
  onQuit: () => void;
}

const COMMANDS = [
  { cmd: "/help", desc: "Show available commands" },
  { cmd: "/clear", desc: "Clear chat and cancel active run" },
  { cmd: "/model", desc: "Change active model" },
  { cmd: "/mode", desc: "Change execution mode" },
  { cmd: "/backend", desc: "Change active backend" },
  { cmd: "/reasoning", desc: "Change reasoning level" },
  { cmd: "/themes", desc: "Open visual theme picker" },
  { cmd: "/auth", desc: "Manage authentication" },
  { cmd: "/workspace", desc: "Show the locked workspace" },
  { cmd: "/copy", desc: "Copy the last response" },
  { cmd: "/exit", desc: "Quit the application" },
] as const;

const FALLBACK_MODEL_SPEC: ModelSpec = {
  status: "unknown",
  contextWindow: null,
  maxOutputTokens: null,
  sourceUrl: "",
  verifiedAt: null,
  error: null,
};

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

function getStatusLine(uiState: UIState): string | null {
  if (uiState.kind === "THINKING") return "✧ Analysing request…";
  if (uiState.kind === "RESPONDING") return "✧ Streaming response…";
  if (uiState.kind === "SHELL_RUNNING") return "✧ Executing shell command…";
  if (uiState.kind === "AWAITING_USER_ACTION") return "✧ Assistant needs one more answer";
  if (uiState.kind === "ERROR") return uiState.message;
  return null;
}

function getPlaceholder(persona: ComposerPersona): string {
  switch (persona) {
    case "answer":
      return "Type your answer";
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
  mode = "",
  model = "",
  reasoningLevel = "",
  tokensUsed = 0,
  modelSpec = FALLBACK_MODEL_SPEC,
  value,
  cursor,
  onChangeInput,
  onSubmit,
  onCancel,
  onChangeValue,
  onChangeCursor,
  onHistoryUp,
  onHistoryDown,
  onOpenBackendPicker,
  onOpenModelPicker,
  onOpenModePicker,
  onOpenThemePicker,
  onOpenAuthPanel,
  onClear,
  onCycleMode,
  onQuit,
}: BottomComposerProps) {
  const theme = useTheme();
  const { cols, mode: layoutMode } = layout;
  const { isFocused } = useFocus({ id: FOCUS_IDS.composer, autoFocus: true });
  const [cursorVisible, setCursorVisible] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollRow, setScrollRow] = useState(0);
  const persona = getComposerPersona(uiState);
  const inputLocked = persona === "busy";
  const allowCommands = persona !== "answer";
  const allowHistory = persona === "idle" || persona === "error";
  const promptPrefix = "❯ ";
  const composerWidth = getShellWidth(cols);
  const composerBodyWidth = getComposerBodyWidth(composerWidth);
  const promptWidth = Math.max(4, composerBodyWidth - getTextWidth(promptPrefix));
  const valueRef = useRef(value);
  const cursorRef = useRef(cursor);
  const pasteBufferRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setCursorVisible((visible) => !visible), 520);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    valueRef.current = value;
    cursorRef.current = cursor;
  }, [cursor, value]);

  const isCmdPrefix = allowCommands && value.startsWith("/");
  const cmdPrefix = value.split(" ")[0]?.toLowerCase() ?? "";
  const showSuggestions = !inputLocked && isCmdPrefix && !value.includes(" ");
  const suggestions = showSuggestions
    ? COMMANDS.filter((command) => command.cmd.startsWith(cmdPrefix)).slice(0, 5)
    : [];
  const suggestionText = suggestions
    .map((suggestion, index) => `${index === selectedIndex ? "›" : "·"} ${suggestion.cmd}`)
    .join("   ");
  const statusLine = getStatusLine(uiState);
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

  useEffect(() => {
    setSelectedIndex(0);
  }, [value]);

  useEffect(() => {
    if (promptViewport.scrollRow !== scrollRow) {
      setScrollRow(promptViewport.scrollRow);
    }
  }, [promptViewport.scrollRow, scrollRow]);

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
    if (key.ctrl) {
      switch (input) {
        case "q":
        case "c":
          onQuit();
          return;
      }
    }

    if (key.escape) {
      onCancel();
      return;
    }

    if (inputLocked) {
      return;
    }

    if (allowCommands && key.ctrl) {
      switch (input) {
        case "b": onOpenBackendPicker(); return;
        case "m": onOpenModelPicker(); return;
        case "p": onOpenModePicker(); return;
        case "t": onOpenThemePicker(); return;
        case "a": onOpenAuthPanel(); return;
        case "l": onClear(); return;
        case "y": onCycleMode(); return;
      }
    }

    if (key.ctrl && (input === "j" || input === "\n")) {
      insertText("\n");
      return;
    }

    if (key.upArrow) {
      if (showSuggestions && suggestions.length > 0) {
        setSelectedIndex((current) => Math.max(0, current - 1));
        return;
      }
      if (allowHistory) onHistoryUp();
      return;
    }

    if (key.downArrow) {
      if (showSuggestions && suggestions.length > 0) {
        setSelectedIndex((current) => Math.min(suggestions.length - 1, current + 1));
        return;
      }
      if (allowHistory) onHistoryDown();
      return;
    }

    if ((key.tab || key.rightArrow) && showSuggestions && suggestions.length > 0) {
      const selected = suggestions[selectedIndex]?.cmd;
      if (selected) {
        commitInputChange(`${selected} `, selected.length + 1);
        return;
      }
    }

    if (key.return) {
      if (showSuggestions && suggestions.length > 0) {
        const selected = suggestions[selectedIndex]?.cmd;
        if (selected && value.trim() !== selected) {
          commitInputChange(`${selected} `, selected.length + 1);
          return;
        }
      }

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

    if (key.backspace) {
      const next = deleteInputBackward({
        value: valueRef.current,
        cursorOffset: cursorRef.current,
      });
      commitInputChange(next.value, next.cursorOffset);
      return;
    }

    if (key.delete) {
      const currentCursor = normalizeCursorOffset(valueRef.current, cursorRef.current);
      const nextCursor = moveCursorRight(valueRef.current, currentCursor);
      if (nextCursor === currentCursor) return;
      commitInputChange(
        valueRef.current.slice(0, currentCursor) + valueRef.current.slice(nextCursor),
        currentCursor,
      );
      return;
    }

    if (!key.ctrl && !key.meta && !key.escape && input && input.length > 0) {
      handlePastedInput(input);
    }
  }, { isActive: isFocused });

  const modeColor = getModeColor(mode, theme);
  const modeLabel = formatModeLabel(mode);
  const tokenDisplay = getTokenBarDisplay(tokensUsed, modelSpec);
  const tokenColor = tokenDisplay.percentage === null ? theme.DIM
    : tokenDisplay.percentage >= 90 ? theme.ERROR
    : tokenDisplay.percentage >= 70 ? theme.WARNING
    : theme.SUCCESS;
  const reasoningSuffix = reasoningLevel ? ` (${reasoningLevel})` : "";
  const metadataLine = `${modeLabel}  ${model}${reasoningSuffix}  Ctrl+M`;
  const isAnswerMode = persona === "answer";

  // The prompt line is shared between bordered and non-bordered layouts.
  const promptLine = (
    <Box flexDirection="column" width="100%">
      {value.length === 0 && !inputLocked ? (
        <Box width="100%" overflow="hidden">
          <Text color={isAnswerMode ? theme.WARNING : theme.PROMPT} bold>{promptPrefix}</Text>
          <Text backgroundColor={cursorVisible ? theme.TEXT : undefined} color={cursorVisible ? theme.PANEL : undefined}>{" "}</Text>
          <Text color={theme.DIM}>{placeholderText}</Text>
        </Box>
      ) : inputLocked ? (
        <Box width="100%" overflow="hidden">
          <Text color={isAnswerMode ? theme.WARNING : theme.PROMPT} bold>{promptPrefix}</Text>
          <Text color={theme.DIM}>{" "}</Text>
        </Box>
      ) : (
        promptViewport.visibleRows.map((row, index) => {
          const visibleCursorRow = promptViewport.cursorRow - promptViewport.scrollRow;
          const isCursorRow = index === visibleCursorRow;
          const segments = isCursorRow
            ? splitTextAtColumn(row.text, promptViewport.cursorColumn)
            : null;

          return (
            <Box key={`${row.start}-${row.end}-${index}`} width="100%" overflow="hidden">
              <Text color={isAnswerMode ? theme.WARNING : theme.PROMPT} bold>{index === 0 ? promptPrefix : "  "}</Text>
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
  );

  return (
    <Box flexDirection="column" paddingBottom={layoutMode === "micro" ? 0 : 1} width="100%">
      {/* Divider line between history and composer */}
      <Box borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderColor={theme.BORDER_SUBTLE} marginBottom={1} />

      {isAnswerMode ? (
        // Answer mode: Highlighted prompt with lightning bolt
        <Box
          flexDirection="column"
          width="100%"
          paddingX={1}
        >
          <Box width="100%" justifyContent="space-between" overflow="hidden" marginBottom={1}>
            <Text color={theme.WARNING} bold>{"⚡ ANSWER AGENT"}</Text>
          </Box>
          {promptLine}
        </Box>
      ) : (
        // Normal mode: clean prompt
        <Box
          flexDirection="column"
          width="100%"
          paddingX={1}
        >
          {promptLine}
        </Box>
      )}

      {showSuggestions && suggestionText && (
        <Box paddingLeft={3} marginTop={1} width="100%" overflow="hidden">
          <Text color={theme.DIM} wrap="truncate">{suggestionText}</Text>
        </Box>
      )}

      {statusLine && !isAnswerMode && (
        <Box paddingLeft={3} marginTop={showSuggestions && suggestionText ? 0 : 1} width="100%" overflow="hidden">
          <Text color={persona === "error" ? theme.ERROR : theme.INFO} wrap="truncate">{statusLine}</Text>
        </Box>
      )}

      {layoutMode !== "micro" && (
        <Box paddingLeft={2} marginTop={1} width="100%" justifyContent="space-between">
          <Box flexGrow={1} flexShrink={1} overflow="hidden">
            <Text color={modeColor} bold>{metadataLine}</Text>
          </Box>
          <Box flexShrink={0}>
            <Text color={tokenColor} bold>{tokenDisplay.usedText}</Text>
            <Text color={theme.DIM}>{"/"}{tokenDisplay.limitText}</Text>
            {tokenDisplay.percentage !== null && (
              <Text color={theme.DIM}>{` ctx ${tokenDisplay.percentage}%`}</Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
