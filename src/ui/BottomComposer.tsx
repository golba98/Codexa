import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useFocus, useInput, useStdin } from "ink";
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
import { getModeDisplaySpec } from "./modeDisplay.js";
import { measureRunFooterRows, RunFooter } from "./RunFooter.js";
import { useTheme } from "./theme.js";
import { clampVisualText, getShellWidth, type Layout } from "./layout.js";
import { getTextWidth, splitTextAtColumn } from "./textLayout.js";
import { useThrottledValue } from "./useThrottledValue.js";
import { sanitizeTerminalOutput } from "../core/terminalSanitize.js";
import { getStdinDebugState, traceInputDebug } from "../core/inputDebug.js";
import * as renderDebug from "../core/perf/renderDebug.js";
import { AnimatedStatusText } from "./AnimatedStatusText.js";
import { isAnimatedBusyState } from "./busyStatusAnimation.js";

type ComposerPersona = "idle" | "busy" | "answer" | "error";
type DeleteIntent = "backspace" | "delete";

const BRACKETED_PASTE_START = /(?:\u001B)?\[200~/;
const BRACKETED_PASTE_END = /(?:\u001B)?\[201~/;
const DELETE_ESCAPE_SEQUENCE = /^\u001b\[3(?:;\d+)?~$/;
const BACKTAB_ESCAPE_SEQUENCE = /\u001b\[Z/;
const CTRL_M_ESCAPE_SEQUENCE = /^\u001b\[(?:109|13);5u$/;
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
  themeName?: string;
  mode?: string;
  model?: string;
  reasoningLevel?: string;
  planMode?: boolean;
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
  onTogglePlanMode: () => void;
  onClear: () => void;
  onCycleMode: () => void;
  onQuit: () => void;
}

export interface BottomComposerMeasureParams {
  layout: Layout;
  uiState: UIState;
  mode?: string;
  model?: string;
  reasoningLevel?: string;
  tokensUsed?: number;
  modelSpec?: ModelSpec;
  value: string;
  cursor: number;
}

const COMMANDS = [
  { cmd: "/help", desc: "Show available commands" },
  { cmd: "/clear", desc: "Clear chat and cancel active run" },
  { cmd: "/model", desc: "Change active model" },
  { cmd: "/mode", desc: "Change execution mode" },
  { cmd: "/backend", desc: "Change active backend" },
  { cmd: "/reasoning", desc: "Change reasoning level" },
  { cmd: "/plan", desc: "Show or toggle session plan mode" },
  { cmd: "/setting", desc: "Open the settings picker" },
  { cmd: "/status", desc: "Show effective runtime configuration" },
  { cmd: "/permissions", desc: "Inspect or update permissions and sandbox controls" },
  { cmd: "/runtime", desc: "Compatibility runtime policy controls" },
  { cmd: "/themes", desc: "Open visual theme picker" },
  { cmd: "/verbose", desc: "Toggle verbose mode (detailed processing info)" },
  { cmd: "/auth", desc: "Manage authentication" },
  { cmd: "/workspace", desc: "Show the locked workspace" },
  { cmd: "/copy", desc: "Copy the full conversation transcript to clipboard" },
  { cmd: "/mouse", desc: "Toggle wheel-scroll mode (on by default; off enables plain drag-select)" },
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
  if (isAnimatedBusyState(uiState.kind)) {
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

export function shouldRenderBusyFooter(layout: Layout, uiState: UIState): boolean {
  return layout.rows <= 24 && getComposerPersona(uiState) === "busy";
}

export function measureBottomComposerRows({
  layout,
  uiState,
  value,
  cursor,
}: BottomComposerMeasureParams): number {
  if (shouldRenderBusyFooter(layout, uiState)) {
    return measureRunFooterRows();
  }

  const persona = getComposerPersona(uiState);
  const inputLocked = persona === "busy";
  const allowCommands = persona !== "answer";
  const composerWidth = getShellWidth(layout.cols);
  const composerBodyWidth = getComposerBodyWidth(composerWidth);
  const promptWidth = Math.max(4, composerBodyWidth - getTextWidth("❯ "));
  const normalizedValue = normalizeInputText(value);
  const normalizedCursor = normalizeCursorOffset(normalizedValue, cursor);
  const promptViewport = createInputViewport({
    text: normalizedValue,
    cursorOffset: normalizedCursor,
    width: promptWidth,
    maxVisibleRows: MAX_VISIBLE_INPUT_ROWS,
    scrollRow: 0,
  });
  const isCmdPrefix = allowCommands && normalizedValue.startsWith("/");
  const cmdPrefix = normalizedValue.split(" ")[0]?.toLowerCase() ?? "";
  const showSuggestions = !inputLocked && isCmdPrefix && !normalizedValue.includes(" ");
  const suggestions = showSuggestions
    ? COMMANDS.filter((command) => command.cmd.startsWith(cmdPrefix)).slice(0, 5)
    : [];
  const showStatusLine = (getStatusLine(uiState) ?? "").length > 0 && persona !== "answer";
  const showMetadata = layout.mode !== "micro" && layout.rows > 24;
  const bottomPadding = layout.mode === "micro" || layout.rows <= 24 ? 0 : 1;

  return (
    promptViewport.visibleRows.length
    + 2
    + (suggestions.length > 0 ? 1 : 0)
    + (showStatusLine ? 1 : 0)
    + (showMetadata ? 1 : 0)
    + bottomPadding
  );
}

function getStatusLine(uiState: UIState): string | null {
  if (uiState.kind === "THINKING") return "✧ Codex is thinking";
  if (uiState.kind === "RESPONDING") return "✧ Codex is streaming";
  if (uiState.kind === "SHELL_RUNNING") return "✧ Codex is running command";
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
  themeName = "purple",
  mode = "",
  model = "",
  reasoningLevel = "",
  planMode = false,
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
  onTogglePlanMode,
  onClear,
  onCycleMode,
  onQuit,
}: BottomComposerProps) {
  renderDebug.useRenderDebug("Composer", {
    cols: layout.cols,
    rows: layout.rows,
    mode: layout.mode,
    uiStateKind: uiState.kind,
    themeName,
    runtimeMode: mode,
    model,
    reasoningLevel,
    planMode,
    tokensUsed,
    modelSpecStatus: modelSpec.status,
    value,
    cursor,
  });

  const { stdin } = useStdin();
  const theme = useTheme();
  const { cols, mode: layoutMode } = layout;
  const crampedViewport = layout.rows <= 24;
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
  const lastPropsValueRef = useRef(value);
  const lastPropsCursorRef = useRef(cursor);
  const pasteBufferRef = useRef<string | null>(null);
  const deleteIntentRef = useRef<DeleteIntent | null>(null);
  const backtabEventTickRef = useRef(false);
  const ctrlMEventTickRef = useRef(false);
  const mouseEventTickRef = useRef(false);
  const backtabEventTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctrlMEventTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouseEventTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleRawInput = (chunk: Buffer | string) => {
      const raw = typeof chunk === "string" ? chunk : chunk.toString();
      const intent = resolveDeleteIntentFromRawInput(raw);
      if (intent) {
        deleteIntentRef.current = intent;
      }

      if (BACKTAB_ESCAPE_SEQUENCE.test(raw)) {
        backtabEventTickRef.current = true;
        if (backtabEventTimeoutRef.current) clearTimeout(backtabEventTimeoutRef.current);
        backtabEventTimeoutRef.current = setTimeout(() => {
          backtabEventTickRef.current = false;
        }, 64);
      }

      // Ctrl+M is not consistently surfaced as input="m" with key.ctrl.
      // Terminals using CSI-u style modified key reporting often emit
      // ESC[109;5u or ESC[13;5u instead. We also support Ctrl+O as a
      // reliable cross-terminal alternative for opening the model picker.
      if (CTRL_M_ESCAPE_SEQUENCE.test(raw)) {
        ctrlMEventTickRef.current = true;
        if (ctrlMEventTimeoutRef.current) clearTimeout(ctrlMEventTimeoutRef.current);
        ctrlMEventTimeoutRef.current = setTimeout(() => {
          ctrlMEventTickRef.current = false;
        }, 64);
      }

      // Explicitly detect terminal mouse reporting escape sequences to swallow
      // the fragments (e.g. "[<0;26;24M") that Ink's readline parser sequentially
      // emits after stripping the ESC prefix.
      if (/\u001b\[<(\d+);(\d+);(\d+)([Mm])/.test(raw) || /\u001b\[M/.test(raw)) {
        mouseEventTickRef.current = true;
        if (mouseEventTimeoutRef.current) clearTimeout(mouseEventTimeoutRef.current);
        mouseEventTimeoutRef.current = setTimeout(() => {
          mouseEventTickRef.current = false;
        }, 32);
      }
    };

    stdin.on("data", handleRawInput);
    return () => {
      stdin.off("data", handleRawInput);
      if (backtabEventTimeoutRef.current) clearTimeout(backtabEventTimeoutRef.current);
      if (ctrlMEventTimeoutRef.current) clearTimeout(ctrlMEventTimeoutRef.current);
      if (mouseEventTimeoutRef.current) clearTimeout(mouseEventTimeoutRef.current);
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
  
  const rawStatusLine = getStatusLine(uiState) ?? "";
  const showStatusLine = rawStatusLine.length > 0 && persona !== "answer";
  
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
    if (mouseEventTickRef.current) {
      return;
    }

    if (backtabEventTickRef.current) {
      backtabEventTickRef.current = false;
      if (backtabEventTimeoutRef.current) {
        clearTimeout(backtabEventTimeoutRef.current);
        backtabEventTimeoutRef.current = null;
      }
      onTogglePlanMode();
      return;
    }

    if (ctrlMEventTickRef.current) {
      ctrlMEventTickRef.current = false;
      if (ctrlMEventTimeoutRef.current) {
        clearTimeout(ctrlMEventTimeoutRef.current);
        ctrlMEventTimeoutRef.current = null;
      }
      if (!inputLocked) {
        traceInputDebug("model_picker_shortcut_received", {
          handler: "BottomComposer.useInput",
          source: "ctrl-m-csi-u",
          inputLocked,
          allowCommands,
          isFocused,
          stdin: getStdinDebugState(stdin),
        });
        onOpenModelPicker();
      }
      return;
    }

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
        case "o":
          traceInputDebug("ctrl_o_received", {
            handler: "BottomComposer.useInput",
            source: "ctrl-o",
            inputLocked,
            allowCommands,
            isFocused,
            stdin: getStdinDebugState(stdin),
          });
          onOpenModelPicker();
          return;
        case "p": onOpenModePicker(); return;
        case "t": onOpenThemePicker(); return;
        case "a": onOpenAuthPanel(); return;
        case "l": onClear(); return;
        case "y": onCycleMode(); return;
      }
    }

    if (allowCommands && key.ctrl && key.return) {
      onOpenModelPicker();
      return;
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

  const modeDisplay = getModeDisplaySpec(mode, theme);
  const tokenDisplay = getTokenBarDisplay(tokensUsed, modelSpec);
  const tokenColor = tokenDisplay.percentage === null ? theme.DIM
    : tokenDisplay.percentage >= 90 ? theme.ERROR
    : tokenDisplay.percentage >= 70 ? theme.WARNING
    : theme.SUCCESS;
  const reasoningSuffix = reasoningLevel ? ` (${reasoningLevel})` : "";
  const isAnswerMode = persona === "answer";
  const showBusyFooter = shouldRenderBusyFooter(layout, uiState);

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

  if (showBusyFooter) {
    return <RunFooter uiState={uiState} onCancel={onCancel} onQuit={onQuit} />;
  }

  return (
    <Box flexDirection="column" paddingBottom={layoutMode === "micro" || crampedViewport ? 0 : 1} width="100%">
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

      {showStatusLine && (
        <Box paddingX={1} marginTop={0} width="100%" justifyContent="space-between" overflow="hidden">
          <Box flexShrink={1} flexGrow={1} overflow="hidden">
            <AnimatedStatusText 
              baseText={rawStatusLine} 
              isActive={inputLocked} 
              isError={persona === "error"} 
            />
          </Box>
          {inputLocked && (
            <Box flexShrink={0}>
              <Text color={theme.DIM}>Esc cancel  Ctrl+C quit</Text>
            </Box>
          )}
        </Box>
      )}

      {layoutMode !== "micro" && !crampedViewport && (
        <Box paddingLeft={1} paddingRight={1} marginTop={0} width="100%" justifyContent="space-between">
          <Box flexGrow={1} flexShrink={1} overflow="hidden">
            <Text
              color={modeDisplay.ringColor}
              backgroundColor={modeDisplay.ringFill}
              bold={modeDisplay.ringBold}
            >
              {modeDisplay.ringGlyph}
            </Text>
            <Text color={theme.DIM}>{" "}</Text>
            <Text color={modeDisplay.labelColor} bold={modeDisplay.labelBold}>{modeDisplay.label}</Text>
            <Text color={theme.DIM}>{"  "}{model}{reasoningSuffix}{"  Ctrl+O"}</Text>
            {planMode && <Text color={theme.ACCENT}>{"  Plan"}</Text>}
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
  if (isAnimatedBusyState(uiState.kind)) {
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
  if (prev.planMode !== next.planMode) return false;
  if (prev.tokensUsed !== next.tokensUsed) return false;
  
  // Re-render if layout changes
  if (prev.layout.cols !== next.layout.cols) return false;
  if (prev.layout.rows !== next.layout.rows) return false;
  if (prev.layout.mode !== next.layout.mode) return false;
  if (prev.themeName !== next.themeName) return false;
  
  // Re-render if model spec status changes
  if (prev.modelSpec?.status !== next.modelSpec?.status) return false;
  if (prev.modelSpec?.contextWindow !== next.modelSpec?.contextWindow) return false;
  
  // Skip re-render - streaming updates within RESPONDING don't affect composer
  return true;
});
