import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useFocus, useInput, useStdin } from "ink";
import { formatModeLabel } from "../config/settings.js";
import type { ModelSpec } from "../core/modelSpecs.js";
import type { UIState } from "../session/types.js";
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
import { getModeColor } from "./modeColor.js";
import { useTheme } from "./theme.js";
import { clampVisualText, getShellWidth, type Layout } from "./layout.js";
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
  if (uiState.kind === "THINKING") return "✧ Analysing request...";
  if (uiState.kind === "RESPONDING") return "✧ Streaming response...";
  if (uiState.kind === "SHELL_RUNNING") return "✧ Executing shell command...";
  if (uiState.kind === "AWAITING_USER_ACTION") return "✧ waiting for your answer";
  if (uiState.kind === "ERROR") return uiState.message;
  return null;
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
  const { stdin } = useStdin();
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
  const promptPrefix = "CODEXA AGENT   › ";
  const composerWidth = getShellWidth(cols);
  const composerBodyWidth = getComposerBodyWidth(composerWidth);
  const promptWidth = Math.max(4, composerBodyWidth - getTextWidth(promptPrefix));
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
    const handleRawInput = (chunk: Buffer | string) => {
      const raw = typeof chunk === "string" ? chunk : chunk.toString();
      const intent = resolveDeleteIntentFromRawInput(raw);
      if (intent) {
        deleteIntentRef.current = intent;
      }
    };

    stdin.on("data", handleRawInput);
    return () => {
      stdin.off("data", handleRawInput);
    };
  }, [stdin]);

  // Sync from props only when props actually change from an external source
  // or after a render cycle has confirmed our local change.
  useEffect(() => {
    if (value !== lastPropsValueRef.current || cursor !== lastPropsCursorRef.current) {
      valueRef.current = value;
      cursorRef.current = cursor;
      lastPropsValueRef.current = value;
      lastPropsCursorRef.current = cursor;
    }
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

    // Update refs immediately to avoid race conditions with fast input events
    valueRef.current = normalizedValue;
    cursorRef.current = normalizedCursor;
    lastPropsValueRef.current = normalizedValue;
    lastPropsCursorRef.current = normalizedCursor;

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
    <Box flexDirection="row" width="100%">
      <Text color={theme.TEXT} bold>{promptPrefix}</Text>
      <Box flexDirection="column" flexGrow={1}>
        {value.length === 0 && !inputLocked ? (
          <Box width="100%" overflow="hidden">
            <Text backgroundColor={cursorVisible ? theme.TEXT : undefined} color={cursorVisible ? theme.PANEL : undefined}>{" "}</Text>
            <Text color={theme.DIM}>{placeholderText}</Text>
          </Box>
        ) : inputLocked ? (
          promptViewport.visibleRows.map((row, index) => (
            <Box key={`${row.start}-${row.end}-${index}`} width="100%" overflow="hidden">
              <Text color={theme.DIM}>{row.text || " "}</Text>
            </Box>
          ))
        ) : (
          promptViewport.visibleRows.map((row, index) => {
            const visibleCursorRow = promptViewport.cursorRow - promptViewport.scrollRow;
            const isCursorRow = index === visibleCursorRow;
            const segments = isCursorRow
              ? splitTextAtColumn(row.text, promptViewport.cursorColumn)
              : null;

            return (
              <Box key={`${row.start}-${row.end}-${index}`} width="100%" overflow="hidden">
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
  );

  return (
    <Box flexDirection="column" paddingBottom={layoutMode === "micro" ? 0 : 1} width="100%">
      {isAnswerMode ? (
        // Answer mode: Highlighted prompt
        <Box
          flexDirection="column"
          width="100%"
          paddingX={1}
          paddingY={0}
          borderStyle="round"
          borderColor={theme.WARNING}
        >
          {promptLine}
        </Box>
      ) : (
        // Normal mode: clean prompt in rounded border
        <Box
          flexDirection="column"
          width="100%"
          paddingX={1}
          paddingY={0}
          borderStyle="round"
          borderColor={theme.BORDER_SUBTLE}
        >
          {promptLine}
        </Box>
      )}

      {showSuggestions && suggestionText && (
        <Box paddingLeft={1} marginTop={0} width="100%" overflow="hidden">
          <Text color={theme.DIM} wrap="truncate">{suggestionText}</Text>
        </Box>
      )}

      {statusLine && !isAnswerMode && (
        <Box paddingX={1} marginTop={0} width="100%" justifyContent="space-between" overflow="hidden">
          <Text color={persona === "error" ? theme.ERROR : theme.INFO} wrap="truncate">{statusLine}</Text>
          {inputLocked && (
            <Text color={theme.DIM}>Esc cancel  Ctrl+C quit</Text>
          )}
        </Box>
      )}

      {layoutMode !== "micro" && (
        <Box paddingLeft={1} paddingRight={1} marginTop={0} width="100%" justifyContent="space-between">
          <Box flexGrow={1} flexShrink={1} overflow="hidden">
            <Text color={theme.TEXT} bold>{modeLabel}</Text>
            <Text color={theme.DIM}>{"  "}{model}{reasoningSuffix}{"  Ctrl+M"}</Text>
          </Box>
          <Box flexShrink={0}>
            <Text color={theme.TEXT}>{tokenDisplay.usedText}</Text>
            <Text color={theme.DIM}>{"/"}{tokenDisplay.limitText}{" ctx "}{tokenDisplay.percentage ?? 0}{"%"}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

// Helper to extract the relevant uiState kind for comparison
function getUiStateKey(uiState: UIState): string {
  // Only re-render when the kind changes to a different persona-relevant state
  // THINKING/RESPONDING/AWAITING_USER_ACTION are all "busy" states
  // We don't need to re-render for every streaming update within RESPONDING
  if (uiState.kind === "THINKING" || uiState.kind === "RESPONDING") {
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

// Memoize to prevent re-renders during streaming when props haven't meaningfully changed
export const MemoizedBottomComposer = memo(BottomComposer, (prev, next) => {
  // Always re-render if the uiState kind changes to a different persona
  const prevKey = getUiStateKey(prev.uiState);
  const nextKey = getUiStateKey(next.uiState);
  if (prevKey !== nextKey) return false;
  
  // Re-render if input-related props change
  if (prev.value !== next.value) return false;
  if (prev.cursor !== next.cursor) return false;
  
  // Re-render if display props change
  if (prev.mode !== next.mode) return false;
  if (prev.model !== next.model) return false;
  if (prev.reasoningLevel !== next.reasoningLevel) return false;
  if (prev.tokensUsed !== next.tokensUsed) return false;
  
  // Re-render if layout changes
  if (prev.layout.cols !== next.layout.cols) return false;
  if (prev.layout.mode !== next.layout.mode) return false;
  
  // Re-render if model spec status changes
  if (prev.modelSpec?.status !== next.modelSpec?.status) return false;
  if (prev.modelSpec?.contextWindow !== next.modelSpec?.contextWindow) return false;
  
  // Skip re-render - streaming updates within RESPONDING don't affect composer
  return true;
});
