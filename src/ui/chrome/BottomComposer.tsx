import { Box, Text, useFocus, useInput, useStdin } from "ink";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { getStdinDebugState, traceInputDebug } from "../../core/debug/inputDebug.js";
import * as renderDebug from "../../core/perf/renderDebug.js";
import type { ModelSpec } from "../../core/providerRuntime/contextMetadata.js";
import { formatContextCompact } from "../../core/providerRuntime/contextMetadata.js";
import { fuzzyFiles, listWorkspaceFiles } from "../../core/workspace/workspaceFiles.js";
import type { ExternalCliStatus, UIState } from "../../session/types.js";
import {
  InputUndo,
  lineBoundary,
  searchHistory,
  verticalCursor,
  wordBoundary,
} from "../input/editor.js";
import { FOCUS_IDS } from "../input/focus.js";
import {
  COMPOSER_ROW_CHROME,
  createInputRowWindow,
  createInputViewport,
  deleteInputBackward,
  deleteInputForward,
  getComposerRowLayout,
  insertInputText,
  moveCursorLeft,
  moveCursorRight,
  normalizeCursorOffset,
  normalizeInputText,
} from "../input/inputBuffer.js";
import {
  createAtomicContentToken,
  createPastedContentToken,
  deleteAdjacentPastedContent,
  isLargePaste,
  moveAcrossPastedContent,
} from "../input/pastedContent.js";
import { type CommandSuggestion, getSlashCommandSuggestions } from "../input/slashCommands.js";
import { clampVisualText, type Layout } from "../layout.js";
import { getModeDisplaySpec } from "../render/modeDisplay.js";
import { THEMES, useTheme } from "../theme.js";
import { AnimatedStatusText } from "./AnimatedStatusText.js";
import { isAnimatedBusyState } from "./busyStatusAnimation.js";
import { Spinner } from "./Spinner.js";

// ─── Types & constants ────────────────────────────────────────────────────────

type ComposerPersona = "idle" | "busy" | "answer" | "error";
type DeleteIntent = "backspace" | "delete";

const BRACKETED_PASTE_START = /(?:\u001B)?\[200~/;
const BRACKETED_PASTE_END = /(?:\u001B)?\[201~/;
const DELETE_ESCAPE_SEQUENCE = /^\u001b\[3(?:;\d+)?~$/;
const BACKTAB_ESCAPE_SEQUENCE = /(?:\u001b\[Z|\u001b\[1;2Z|\u001b\[9;2u|\u001b\[27;2;9~)/;
const CTRL_M_ESCAPE_SEQUENCE = /^\u001b\[109;5u$/;
const CTRL_ALT_P_ESCAPE_SEQUENCE = /(?:\x1b\x10|\x1b\[112;[78]u)/;
const MAX_VISIBLE_INPUT_ROWS = 5;
const PASTE_CHUNK_CANDIDATE_MIN = 64;
const PASTE_CHUNK_SETTLE_MS = 12;

function resolveDeleteIntentFromRawInput(raw: string): DeleteIntent | null {
  if (raw === "\b" || raw === "\x08" || raw === "\u007f" || raw === "\u001b\u007f") {
    return "backspace";
  }

  if (DELETE_ESCAPE_SEQUENCE.test(raw)) {
    return "delete";
  }

  return null;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// ─── Exported helpers ────────────────────────────────────────────────────────

export function getTokenBarDisplay(tokensUsed: number, modelSpec: ModelSpec) {
  if (modelSpec.status !== "verified") {
    return {
      usedText: "Context",
      limitText: "Unknown",
      percentage: null as number | null,
      isEstimatedLimit: false,
      hasKnownLimit: false,
    };
  }
  const isEstimated = modelSpec.isEstimated === true;
  const pct =
    modelSpec.contextWindow > 0
      ? Math.min(100, Math.floor((tokensUsed / modelSpec.contextWindow) * 100))
      : 0;
  return {
    usedText: tokensUsed.toLocaleString("en-US"),
    limitText: isEstimated
      ? `~${formatContextCompact(modelSpec.contextWindow)}`
      : modelSpec.contextWindow.toLocaleString("en-US"),
    percentage: pct,
    isEstimatedLimit: isEstimated,
    hasKnownLimit: true,
  };
}

export interface BottomComposerProps {
  layout: Layout;
  width?: number;
  uiState: UIState;
  stopping?: boolean;
  themeName?: string;
  mode?: string;
  model?: string;
  footerModelDisplay?: string;
  reasoningLevel?: string;
  contextDisplay?: string;
  planMode?: boolean;
  showBusyLoader?: boolean;
  tokensUsed?: number;
  modelSpec?: ModelSpec;
  value: string;
  cursor: number;
  onChangeInput: (value: string, cursor: number) => void;
  onRegisterPaste?: (label: string, content: string) => void;
  onPasteImage?: () => void;
  onSubmit: () => void;
  onInterrupt?: () => void;
  onRedraw?: () => void;
  onTranscript?: () => void;
  onExternalEditor?: () => void;
  onSendNow?: () => void;
  onRegisterFile?: (token: string, path: string) => void;
  workspaceRoot?: string;
  history?: readonly string[];
  queueCount?: number;
  queuePaused?: boolean;
  onCancel: () => void;
  onHistoryUp: () => void;
  onHistoryDown: () => void;
  onOpenProviderPicker?: () => void;
  onOpenModelPicker: () => void;
  onCycleMode: () => void;
  onQuit: () => void;
  activeProviderId?: string;
  externalCliStatus?: ExternalCliStatus;
}

export interface BottomComposerMeasureParams {
  layout: Layout;
  width?: number;
  uiState: UIState;
  stopping?: boolean;
  mode?: string;
  model?: string;
  reasoningLevel?: string;
  tokensUsed?: number;
  modelSpec?: ModelSpec;
  value: string;
  cursor: number;
  queueCount?: number;
}

export function isBacktabSequence(raw: string): boolean {
  return BACKTAB_ESCAPE_SEQUENCE.test(raw);
}

export interface CommandSuggestionState {
  showSuggestions: boolean;
  reserveSuggestionRow: boolean;
  suggestions: readonly CommandSuggestion[];
}

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

export function getCommandSuggestionState({
  value,
  allowCommands,
}: {
  value: string;
  allowCommands: boolean;
}): CommandSuggestionState {
  const isCmdPrefix = allowCommands && value.startsWith("/");
  const cmdPrefix = value.split(" ")[0]?.toLowerCase() ?? "";
  const canSuggest = isCmdPrefix && !value.includes(" ");
  const matchingSuggestions = canSuggest ? getSlashCommandSuggestions(cmdPrefix) : [];
  const exactMatch = matchingSuggestions.find((command) => command.cmd === cmdPrefix);
  const exactMatchAliases = exactMatch && "aliases" in exactMatch ? exactMatch.aliases : undefined;
  const suppressExactMatch = exactMatch ? !(exactMatchAliases?.length ?? 0) : true;
  const suggestions = matchingSuggestions.filter(
    (command) => !(suppressExactMatch && command.cmd === cmdPrefix),
  );

  return {
    showSuggestions: canSuggest,
    reserveSuggestionRow: matchingSuggestions.length > 0,
    suggestions,
  };
}

export function measureBottomComposerRows({
  layout,
  width = layout.cols,
  uiState,
  value,
  cursor,
  queueCount = 0,
  stopping = false,
}: BottomComposerMeasureParams): number {
  const persona = getComposerPersona(uiState);
  const allowCommands = persona !== "answer";
  const { editorWidth: promptWidth } = getComposerRowLayout(width);
  const normalizedValue = normalizeInputText(value);
  const normalizedCursor = normalizeCursorOffset(normalizedValue, cursor);
  const promptViewport = createInputViewport({
    text: normalizedValue,
    cursorOffset: normalizedCursor,
    width: promptWidth,
    maxVisibleRows: MAX_VISIBLE_INPUT_ROWS,
    scrollRow: 0,
  });
  const commandSuggestionState = getCommandSuggestionState({
    value: normalizedValue,
    allowCommands,
  });

  const bottomPadding = layout.mode === "compact" ? 0 : 1;
  const visibleStatusLine = getVisibleComposerStatusLine({
    uiState,
    stopping,
    value: normalizedValue,
    allowCommands,
  });
  const transientStatusRows = visibleStatusLine.length > 0 ? 1 : 0;
  const visiblePromptRows = promptViewport.visibleRows.length;

  return (
    visiblePromptRows +
    2 +
    (queueCount > 0 || /(?:^|\s)@[^\s]*$/.test(value.slice(0, cursor)) ? 1 : 0) +
    (commandSuggestionState.reserveSuggestionRow ? 1 : 0) +
    transientStatusRows +
    1 +
    bottomPadding
  );
}

function getExternalCliLabel(providerId: string): string | null {
  if (providerId === "google") return "Gemini CLI";
  if (providerId === "anthropic") return "Claude Code";
  if (providerId === "openai") return "Codex CLI";
  return null;
}

function getProviderReadyLabel(providerId: string): string | null {
  if (providerId === "google") return "Gemini";
  if (providerId === "anthropic") return "Claude";
  if (providerId === "openai") return "Codex";
  return null;
}

function getStatusLine(
  uiState: UIState,
  activeProviderId?: string,
  runElapsedSeconds?: number,
  externalCliStatus?: ExternalCliStatus,
): string | null {
  if (uiState.kind === "THINKING") {
    const cliLabel = activeProviderId ? getExternalCliLabel(activeProviderId) : null;
    if (cliLabel && externalCliStatus !== "ready") {
      const elapsed = runElapsedSeconds ?? 0;
      const timerStr = elapsed > 0 ? `  ${formatElapsed(elapsed)}` : "";
      if (elapsed >= 15) return `Still waiting for ${cliLabel}${timerStr}`;
      if (elapsed >= 5)
        return `${cliLabel} is still starting. The upstream CLI can take a moment${timerStr}`;
      return `Starting ${cliLabel}${timerStr}`;
    }
    return `✧ ${getProviderReadyLabel(activeProviderId ?? "") ?? "Ubume"} is working`;
  }
  if (uiState.kind === "RESPONDING") {
    const readyLabel = activeProviderId ? getProviderReadyLabel(activeProviderId) : null;
    if (readyLabel) return `✧ ${readyLabel} is working`;
    return `✧ ${getProviderReadyLabel(activeProviderId ?? "") ?? "Ubume"} is working`;
  }
  if (uiState.kind === "ANSWER_VISIBLE") return "✧ Ubume response complete";
  if (uiState.kind === "SHELL_RUNNING") return "✧ Ubume is running command";
  if (uiState.kind === "AWAITING_USER_ACTION") return "✧ waiting for your answer";
  if (uiState.kind === "ERROR") return uiState.message;
  return null;
}

export function getVisibleComposerStatusLine({
  uiState,
  value,
  allowCommands,
  activeProviderId,
  runElapsedSeconds,
  externalCliStatus,
  stopping = false,
}: {
  uiState: UIState;
  stopping?: boolean;
  value: string;
  allowCommands: boolean;
  activeProviderId?: string;
  runElapsedSeconds?: number;
  externalCliStatus?: ExternalCliStatus;
}): string {
  if (stopping) return "✧ Stopping · Ctrl+C again to exit";
  const persona = getComposerPersona(uiState);
  const rawStatusLine =
    getStatusLine(uiState, activeProviderId, runElapsedSeconds, externalCliStatus) ?? "";
  const isCommandDraft = allowCommands && value.startsWith("/");

  if (
    rawStatusLine.length === 0 ||
    persona === "answer" ||
    (isCommandDraft && persona !== "busy")
  ) {
    return "";
  }

  return rawStatusLine;
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
      return "Ask Ubume, run !shell, or use /command";
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

function renderFooterRuntime(displayStr: string, theme: any) {
  // e.g. "Claude Code CLI / Sonnet 4.6 (Low)"
  const slashIndex = displayStr.indexOf("/");
  if (slashIndex === -1) {
    return (
      <Text color={theme.model} wrap="truncate">
        {displayStr}
      </Text>
    );
  }
  const providerPart = displayStr.substring(0, slashIndex).trim();
  let remaining = displayStr.substring(slashIndex + 1).trim();

  const parenIndex = remaining.indexOf("(");
  if (parenIndex === -1) {
    return (
      <Box flexDirection="row" overflow="hidden">
        <Text color={theme.provider}>{providerPart}</Text>
        <Text color={theme.textMuted}>{" / "}</Text>
        <Text color={theme.model}>{remaining}</Text>
      </Box>
    );
  }

  const modelPart = remaining.substring(0, parenIndex).trim();
  let reasoningPart = remaining.substring(parenIndex + 1).trim();
  if (reasoningPart.endsWith(")")) {
    reasoningPart = reasoningPart.substring(0, reasoningPart.length - 1).trim();
  }

  return (
    <Box flexDirection="row" overflow="hidden">
      <Text color={theme.provider}>{providerPart}</Text>
      <Text color={theme.textMuted}>{" / "}</Text>
      <Text color={theme.model}>{modelPart}</Text>
      <Text color={theme.textMuted}>{" ("}</Text>
      <Text color={theme.accentMuted}>{reasoningPart}</Text>
      <Text color={theme.textMuted}>{")"}</Text>
    </Box>
  );
}

export function BottomComposer({
  layout,
  width = layout.cols,
  uiState,
  themeName = "purple",
  mode = "",
  model = "",
  footerModelDisplay,
  reasoningLevel = "",
  contextDisplay,
  planMode = false,
  showBusyLoader = true,
  stopping = false,
  tokensUsed = 0,
  modelSpec = FALLBACK_MODEL_SPEC,
  value,
  cursor,
  onChangeInput,
  onRegisterPaste,
  onPasteImage,
  onSubmit,
  onInterrupt,
  onRedraw,
  onTranscript,
  onExternalEditor,
  onSendNow,
  onRegisterFile,
  workspaceRoot,
  history = [],
  queueCount = 0,
  queuePaused = false,
  onCancel,
  onHistoryUp,
  onHistoryDown,
  onOpenProviderPicker = () => undefined,
  onOpenModelPicker,
  onCycleMode,
  onQuit,
  activeProviderId = "",
  externalCliStatus,
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
  renderDebug.useLifecycleDebug("Composer", {
    uiStateKind: uiState.kind,
    cols: layout.cols,
    rows: layout.rows,
    mode: layout.mode,
  });
  renderDebug.traceLayoutValidity("Composer", {
    cols: layout.cols,
    rows: layout.rows,
  });

  const { stdin } = useStdin();
  const inheritedTheme = useTheme();
  // The composer is memoized and also rendered across the main/overlay shell
  // boundary. Resolve the explicit active theme name here so the runtime row
  // (provider, model, reasoning and context) cannot retain a stale inherited
  // token set during a theme transition. Custom themes remain sourced from the
  // provider because their merged tokens are supplied there.
  const theme = themeName === "custom" ? inheritedTheme : (THEMES[themeName] ?? inheritedTheme);
  const { mode: layoutMode } = layout;
  const { isFocused } = useFocus({ id: FOCUS_IDS.composer, autoFocus: true });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollRow, setScrollRow] = useState(0);
  const persona = getComposerPersona(uiState);
  const undo = useRef(new InputUndo());
  const killText = useRef("");
  const desiredColumn = useRef<number | undefined>(undefined);
  const chord = useRef(false);
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const searchOriginal = useRef({ value: "", cursor: 0 });
  const [searchOffset, setSearchOffset] = useState(0);
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const fileMatch = value.slice(0, cursor).match(/(?:^|\s)@([^\s]*)$/);
  const fileQuery = fileMatch?.[1];
  const [dismissedFile, setDismissedFile] = useState<string | null>(null);
  const fileSuggestions =
    fileQuery !== undefined && dismissedFile !== `${value}:${cursor}`
      ? fuzzyFiles(filePaths, fileQuery)
      : [];
  useEffect(() => {
    if (fileQuery === undefined || !workspaceRoot) return;
    let stale = false;
    const timer = setTimeout(() => {
      void listWorkspaceFiles(workspaceRoot)
        .then((paths) => {
          if (!stale) setFilePaths(paths);
        })
        .catch(() => {
          if (!stale) setFilePaths([]);
        });
    }, 100);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [fileQuery, workspaceRoot]);
  const [runElapsedSeconds, setRunElapsedSeconds] = useState(0);

  useEffect(() => {
    if (uiState.kind !== "THINKING") {
      setRunElapsedSeconds(0);
      return;
    }
    setRunElapsedSeconds(0);
    const interval = setInterval(() => {
      setRunElapsedSeconds((s) => s + 1);
    }, 1_000);
    return () => clearInterval(interval);
  }, [uiState.kind]);

  const allowCommands = persona !== "answer";
  const allowHistory = persona !== "answer";
  const promptPrefix = COMPOSER_ROW_CHROME.prompt;
  const rowLayout = getComposerRowLayout(width);
  const promptWidth = rowLayout.editorWidth;
  const valueRef = useRef(value);
  const cursorRef = useRef(cursor);
  const lastPropsValueRef = useRef(value);
  const lastPropsCursorRef = useRef(cursor);
  const pasteBufferRef = useRef<string | null>(null);
  const pasteChunkBufferRef = useRef<string | null>(null);
  const pasteChunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deleteIntentRef = useRef<DeleteIntent | null>(null);
  const backtabEventTickRef = useRef(false);
  const ctrlMEventTickRef = useRef(false);
  const ctrlAltPEventTickRef = useRef(false);
  const mouseEventTickRef = useRef(false);
  const backtabEventTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctrlMEventTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctrlAltPEventTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouseEventTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleRawInput = (chunk: Buffer | string) => {
      const raw = typeof chunk === "string" ? chunk : chunk.toString();
      const intent = resolveDeleteIntentFromRawInput(raw);
      if (intent) {
        deleteIntentRef.current = intent;
      }

      if (isBacktabSequence(raw)) {
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

      // ESC ^P or CSI u style modified key reporting for Ctrl+Alt+P.
      if (CTRL_ALT_P_ESCAPE_SEQUENCE.test(raw)) {
        ctrlAltPEventTickRef.current = true;
        if (ctrlAltPEventTimeoutRef.current) clearTimeout(ctrlAltPEventTimeoutRef.current);
        ctrlAltPEventTimeoutRef.current = setTimeout(() => {
          ctrlAltPEventTickRef.current = false;
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
      if (pasteChunkTimerRef.current) clearTimeout(pasteChunkTimerRef.current);
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

  const commandSuggestionState = getCommandSuggestionState({
    value,
    allowCommands,
  });
  const { showSuggestions, suggestions } = commandSuggestionState;
  const suggestionText = suggestions
    .map((suggestion, index) => `${index === selectedIndex ? "›" : "·"} ${suggestion.cmd}`)
    .join("   ");

  const rawStatusLine = getVisibleComposerStatusLine({
    uiState,
    value,
    allowCommands,
    activeProviderId,
    runElapsedSeconds,
    externalCliStatus,
    stopping,
  });
  const showStatusLine = rawStatusLine.length > 0;
  const showTransientStatusRow = showStatusLine;

  const promptViewport = useMemo(
    () =>
      createInputViewport({
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

    undo.current.record(
      { value: valueRef.current, cursor: cursorRef.current },
      { value: normalizedValue, cursor: normalizedCursor },
    );
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

  const insertPaste = (text: string) => {
    const pastedText = normalizeInputText(text);
    if (isLargePaste(pastedText)) {
      const label = createPastedContentToken(pastedText);
      onRegisterPaste?.(label, pastedText);
      insertText(label);
      return;
    }
    insertText(pastedText);
  };

  const flushPasteChunks = () => {
    const buffered = pasteChunkBufferRef.current;
    pasteChunkBufferRef.current = null;
    pasteChunkTimerRef.current = null;
    if (buffered) insertPaste(buffered);
  };

  const bufferPasteChunk = (text: string) => {
    pasteChunkBufferRef.current = `${pasteChunkBufferRef.current ?? ""}${text}`;
    if (pasteChunkTimerRef.current) clearTimeout(pasteChunkTimerRef.current);
    pasteChunkTimerRef.current = setTimeout(flushPasteChunks, PASTE_CHUNK_SETTLE_MS);
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
        insertPaste(pastedText);
        remaining = remaining.slice(endMatch.index + endMatch[0].length);
        continue;
      }

      const startMatch = BRACKETED_PASTE_START.exec(remaining);
      if (!startMatch) {
        // Ink/readline may consume bracketed-paste delimiters and deliver the
        // payload as one or more input events. Coalesce burst chunks before
        // applying the large-paste threshold so multi-kilobyte pastes cannot
        // leak into the composer as several smaller raw fragments.
        if (pasteChunkBufferRef.current !== null || remaining.length >= PASTE_CHUNK_CANDIDATE_MIN) {
          bufferPasteChunk(remaining);
        } else {
          insertText(normalizeInputText(remaining));
        }
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

  useInput(
    (input, key) => {
      if (mouseEventTickRef.current) {
        return;
      }

      if (backtabEventTickRef.current) {
        backtabEventTickRef.current = false;
        if (backtabEventTimeoutRef.current) {
          clearTimeout(backtabEventTimeoutRef.current);
          backtabEventTimeoutRef.current = null;
        }
        onCycleMode();
        return;
      }

      // Ink exposes Shift+Tab directly on terminals whose parser understands the
      // active keyboard protocol. Keep this path in addition to raw-sequence
      // detection so the shortcut works in VTE, Kitty, and Windows terminals.
      if (key.tab && key.shift) {
        onCycleMode();
        return;
      }

      if (ctrlMEventTickRef.current) {
        ctrlMEventTickRef.current = false;
        if (ctrlMEventTimeoutRef.current) {
          clearTimeout(ctrlMEventTimeoutRef.current);
          ctrlMEventTimeoutRef.current = null;
        }
        traceInputDebug("model_picker_shortcut_received", {
          handler: "BottomComposer.useInput",
          source: "ctrl-m-csi-u",
          allowCommands,
          isFocused,
          stdin: getStdinDebugState(stdin),
        });
        onOpenModelPicker();
        return;
      }

      if (ctrlAltPEventTickRef.current) {
        ctrlAltPEventTickRef.current = false;
        if (ctrlAltPEventTimeoutRef.current) {
          clearTimeout(ctrlAltPEventTimeoutRef.current);
          ctrlAltPEventTimeoutRef.current = null;
        }
        if (allowCommands) {
          onOpenProviderPicker();
        }
        return;
      }

      if (key.ctrl && input === "q") {
        onQuit();
        return;
      }
      if (key.ctrl && input === "c") {
        onInterrupt?.();
        return;
      }
      if (key.ctrl && input === "l") {
        onRedraw?.();
        return;
      }
      if (searchQuery !== null) {
        if (key.escape) {
          commitInputChange(searchOriginal.current.value, searchOriginal.current.cursor);
          setSearchQuery(null);
          return;
        }
        if (key.return) {
          setSearchQuery(null);
          return;
        }
        let query = searchQuery;
        let offset = 0;
        if (key.ctrl && input === "r") offset = searchOffset + 1;
        else if (key.backspace) query = Array.from(query).slice(0, -1).join("");
        else if (!key.ctrl && !key.meta && input) query += input;
        else return;
        const match = searchHistory(history, query, offset);
        setSearchQuery(query);
        setSearchOffset(offset);
        if (match !== undefined) commitInputChange(match, match.length);
        return;
      }
      if (key.escape && fileSuggestions.length) {
        setDismissedFile(`${value}:${cursor}`);
        return;
      }
      if (key.escape) {
        onCancel();
        return;
      }
      if (chord.current) {
        chord.current = false;
        if (key.ctrl && input === "s") {
          onSendNow?.();
          return;
        }
      }
      if (key.ctrl && input === "x") {
        chord.current = true;
        return;
      }
      if (key.ctrl && input === "o") {
        onTranscript?.();
        return;
      }
      if (key.ctrl && input === "g") {
        onExternalEditor?.();
        return;
      }
      if (key.ctrl && input === "r") {
        searchOriginal.current = { value: valueRef.current, cursor: cursorRef.current };
        setSearchQuery("");
        setSearchOffset(0);
        const match = searchHistory(history, "");
        if (match !== undefined) commitInputChange(match, match.length);
        return;
      }
      if (key.meta && input === "p") {
        onOpenModelPicker();
        return;
      }
      const text = valueRef.current;
      const position = cursorRef.current;
      if (key.home || key.end) {
        desiredColumn.current = undefined;
        commitInputChange(text, lineBoundary(text, position, key.end));
        return;
      }
      if (key.ctrl && (input === "a" || input === "e")) {
        desiredColumn.current = undefined;
        commitInputChange(text, lineBoundary(text, position, input === "e"));
        return;
      }
      if (key.ctrl && (input === "b" || input === "f")) {
        desiredColumn.current = undefined;
        commitInputChange(
          text,
          input === "b"
            ? (moveAcrossPastedContent(text, position, "left") ?? moveCursorLeft(text, position))
            : (moveAcrossPastedContent(text, position, "right") ?? moveCursorRight(text, position)),
        );
        return;
      }
      if (key.meta && (input === "b" || input === "f")) {
        desiredColumn.current = undefined;
        commitInputChange(text, wordBoundary(text, position, input === "b" ? -1 : 1));
        return;
      }
      if (key.ctrl && ["w", "u", "k"].includes(input)) {
        const edge =
          input === "w"
            ? wordBoundary(text, position, -1, true)
            : lineBoundary(text, position, input === "k");
        const from = Math.min(edge, position),
          to = Math.max(edge, position);
        killText.current = text.slice(from, to);
        commitInputChange(text.slice(0, from) + text.slice(to), from);
        return;
      }
      if (key.ctrl && input === "y") {
        insertText(killText.current);
        return;
      }
      if (key.ctrl && (input === "_" || input === "\x1f")) {
        const previous = undo.current.undo();
        if (previous) {
          valueRef.current = previous.value;
          cursorRef.current = previous.cursor;
          onChangeInput(previous.value, previous.cursor);
        }
        return;
      }
      if (key.ctrl && input === "v") {
        onPasteImage?.();
        return;
      }
      if (key.ctrl && key.return) {
        onSendNow?.();
        return;
      }
      if (
        (key.return && (key.shift || key.meta)) ||
        (key.ctrl && (input === "j" || input === "\n"))
      ) {
        insertText("\n");
        return;
      }
      if (key.upArrow || key.downArrow || (key.ctrl && (input === "p" || input === "n"))) {
        const direction = key.upArrow || input === "p" ? -1 : 1;
        const list = fileSuggestions.length ? fileSuggestions : showSuggestions ? suggestions : [];
        if (list.length) {
          setSelectedIndex((index) => Math.max(0, Math.min(list.length - 1, index + direction)));
          return;
        }
        const next = verticalCursor(text, position, promptWidth, direction, desiredColumn.current);
        desiredColumn.current = next.column;
        if (!next.boundary) commitInputChange(text, next.cursor);
        else if (allowHistory) {
          direction < 0 ? onHistoryUp() : onHistoryDown();
          desiredColumn.current = undefined;
        }
        return;
      }
      desiredColumn.current = undefined;
      if ((key.tab || key.return) && fileSuggestions.length && fileQuery !== undefined) {
        const path = fileSuggestions[Math.min(selectedIndex, fileSuggestions.length - 1)]!;
        const token = createAtomicContentToken(`[File: ${path}]`);
        onRegisterFile?.(token, path);
        const start = position - fileQuery.length - 1;
        commitInputChange(
          text.slice(0, start) + token + " " + text.slice(position),
          start + token.length + 1,
        );
        return;
      }
      if ((key.tab || key.rightArrow) && showSuggestions && suggestions.length > 0) {
        const selected = suggestions[selectedIndex]?.cmd;
        if (selected) commitInputChange(`${selected} `, selected.length + 1);
        return;
      }
      if (key.return) {
        if (text.slice(0, position).endsWith("\\")) {
          commitInputChange(text.slice(0, position - 1) + "\n" + text.slice(position), position);
          return;
        }
        if (showSuggestions && suggestions.length > 0) {
          const selected = suggestions[selectedIndex];
          if (
            selected &&
            text.trim().toLowerCase() !== selected.cmd &&
            !(
              "aliases" in selected &&
              selected.aliases?.some((alias) => alias === text.trim().toLowerCase())
            )
          ) {
            commitInputChange(`${selected.cmd} `, selected.cmd.length + 1);
            return;
          }
        }
        if (text.trim()) onSubmit();
        return;
      }

      if (key.leftArrow) {
        const nextCursor =
          moveAcrossPastedContent(valueRef.current, cursorRef.current, "left") ??
          moveCursorLeft(valueRef.current, cursorRef.current);
        commitInputChange(valueRef.current, nextCursor);
        return;
      }

      if (key.rightArrow) {
        const nextCursor =
          moveAcrossPastedContent(valueRef.current, cursorRef.current, "right") ??
          moveCursorRight(valueRef.current, cursorRef.current);
        commitInputChange(valueRef.current, nextCursor);
        return;
      }

      if (key.backspace || input === "\b" || (input === "\u007f" && !key.delete)) {
        deleteIntentRef.current = null;
        const next =
          deleteAdjacentPastedContent(valueRef.current, cursorRef.current, "backward") ??
          deleteInputBackward({
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

        const next =
          deleteAdjacentPastedContent(valueRef.current, cursorRef.current, "forward") ??
          deleteInputForward({
            value: valueRef.current,
            cursorOffset: cursorRef.current,
          });
        commitInputChange(next.value, next.cursorOffset);
        return;
      }

      if (
        !key.ctrl &&
        !key.meta &&
        !key.escape &&
        input &&
        input.length > 0 &&
        input !== "\u007f" &&
        input !== "\b"
      ) {
        handlePastedInput(input);
      }
    },
    { isActive: isFocused },
  );

  const tokenDisplay = getTokenBarDisplay(tokensUsed, modelSpec);
  const reasoningSuffix = reasoningLevel ? ` (${reasoningLevel})` : "";
  const footerRuntimeDisplay = footerModelDisplay ?? `${model}${reasoningSuffix}`;
  const isAnswerMode = persona === "answer";

  // The prompt line is shared between bordered and non-bordered layouts.
  const promptLine = (
    <Box flexDirection="row" width={rowLayout.bodyWidth}>
      <Box width={rowLayout.promptWidth} flexShrink={0}>
        <Text color={theme.text} bold>
          {promptPrefix}
        </Text>
      </Box>
      <Box flexDirection="column" width={promptWidth} flexShrink={0} overflow="hidden">
        {value.length === 0 ? (
          <Box width="100%" overflow="hidden">
            <Text
              backgroundColor={isFocused ? theme.text : undefined}
              color={isFocused ? theme.surface : undefined}
            >
              {" "}
            </Text>
            <Text color={theme.textDim}>{placeholderText}</Text>
          </Box>
        ) : (
          promptViewport.visibleRows.map((row, index) => {
            const visibleCursorRow = promptViewport.cursorRow - promptViewport.scrollRow;
            const isCursorRow = index === visibleCursorRow;
            const segments = createInputRowWindow(
              row.text,
              promptWidth,
              isCursorRow ? promptViewport.cursorColumn : undefined,
            );

            return (
              <Box key={`${row.start}-${row.end}-${index}`} width="100%" overflow="hidden">
                {isCursorRow ? (
                  <>
                    <Text color={theme.text}>{segments.before}</Text>
                    <Text
                      backgroundColor={isFocused ? theme.text : undefined}
                      color={isFocused ? theme.surface : undefined}
                    >
                      {segments.current}
                    </Text>
                    <Text color={theme.text}>{segments.after}</Text>
                  </>
                ) : (
                  <Text color={theme.text}>{segments.before || " "}</Text>
                )}
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );

  return (
    <Box flexDirection="column" paddingBottom={layoutMode === "compact" ? 0 : 1} width={width}>
      {isAnswerMode ? (
        // Answer mode: Highlighted prompt
        <Box
          flexDirection="column"
          width="100%"
          paddingLeft={COMPOSER_ROW_CHROME.paddingLeft}
          paddingRight={COMPOSER_ROW_CHROME.paddingRight}
          paddingY={0}
          borderStyle="round"
          borderColor={theme.warning}
        >
          {promptLine}
        </Box>
      ) : (
        // Normal mode: clean prompt in rounded border
        <Box
          flexDirection="column"
          width="100%"
          paddingLeft={COMPOSER_ROW_CHROME.paddingLeft}
          paddingRight={COMPOSER_ROW_CHROME.paddingRight}
          paddingY={0}
          borderStyle="round"
          borderColor={theme.border}
        >
          {promptLine}
        </Box>
      )}

      {(fileQuery !== undefined || queueCount > 0) && (
        <Box paddingX={1} height={1} overflow="hidden">
          <Text color={theme.textDim} wrap="truncate">
            {searchQuery !== null
              ? `History search: ${searchQuery} · Ctrl+R next · Enter accept · Esc cancel`
              : fileQuery !== undefined
                ? fileSuggestions[selectedIndex]
                  ? `@ ${fileSuggestions[selectedIndex]} · ↑↓ choose · Tab attach`
                  : "No matching files"
                : `${queueCount} queued${queuePaused ? " (paused)" : ""} · /queue · Ctrl+X Ctrl+S send now`}
          </Text>
        </Box>
      )}
      {commandSuggestionState.reserveSuggestionRow && (
        <Box paddingLeft={1} marginTop={0} width="100%" overflow="hidden">
          <Text color={theme.textDim} wrap="truncate">
            {suggestionText || " "}
          </Text>
        </Box>
      )}

      {showTransientStatusRow && (
        <Box
          paddingX={1}
          marginTop={0}
          height={1}
          width="100%"
          justifyContent="space-between"
          overflow="hidden"
        >
          <>
            <Box flexShrink={1} flexGrow={1} overflow="hidden" flexDirection="row">
              {!!getExternalCliLabel(activeProviderId ?? "") && uiState.kind === "THINKING" && (
                <>
                  <Spinner color={theme.accent} />
                  <Text> </Text>
                </>
              )}
              <AnimatedStatusText
                baseText={rawStatusLine}
                isActive={!stopping && persona === "busy" && showBusyLoader}
                animationStyle="flow"
                isError={persona === "error"}
              />
            </Box>
            {persona === "busy" && (
              <Box flexShrink={0}>
                <Text color={theme.textDim}>Enter queue · Ctrl+C stop</Text>
              </Box>
            )}
          </>
        </Box>
      )}

      <Box
        paddingLeft={1}
        paddingRight={1}
        marginTop={0}
        width="100%"
        justifyContent="space-between"
      >
        <Box flexGrow={1} flexShrink={1} overflow="hidden" flexDirection="row">
          {searchQuery !== null && fileQuery === undefined && queueCount === 0 ? (
            <Text
              color={theme.textDim}
              wrap="truncate"
            >{`History search: ${searchQuery} · Ctrl+R next · Enter accept · Esc cancel`}</Text>
          ) : (
            renderFooterRuntime(footerRuntimeDisplay, theme)
          )}
          {searchQuery !== null ? null : planMode ? (
            <Text color={theme.accent}>{"  · PLAN"}</Text>
          ) : mode ? (
            <Text color={getModeDisplaySpec(mode, theme).ringColor}>
              {`  · ${getModeDisplaySpec(mode, theme).label}`}
            </Text>
          ) : null}
        </Box>
        <Box flexShrink={0}>
          {contextDisplay ? (
            <Box flexDirection="row">
              <Text color={theme.textMuted}>Context: </Text>
              <Text color={theme.context}>{contextDisplay}</Text>
            </Box>
          ) : tokenDisplay.hasKnownLimit ? (
            <Box flexDirection="row">
              <Text color={theme.textMuted}>Context: </Text>
              <Text color={theme.context}>{tokenDisplay.usedText}</Text>
              <Text color={theme.textDim}>
                {" / "}
                {tokenDisplay.limitText}
                {tokenDisplay.percentage !== null
                  ? ` · ${tokenDisplay.isEstimatedLimit ? "~" : ""}${tokenDisplay.percentage}%`
                  : ""}
              </Text>
            </Box>
          ) : (
            <Box flexDirection="row">
              <Text color={theme.textMuted}>Context: </Text>
              <Text color={theme.textDim}>Unknown</Text>
            </Box>
          )}
        </Box>
      </Box>
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

// ─── Memoized export ─────────────────────────────────────────────────────────

// Skips re-renders during streaming when props haven't meaningfully changed.
export function areBottomComposerPropsEqual(
  prev: BottomComposerProps,
  next: BottomComposerProps,
): boolean {
  // Always re-render if the uiState kind changes to a different persona
  const prevKey = getUiStateKey(prev.uiState);
  const nextKey = getUiStateKey(next.uiState);
  if (prevKey !== nextKey) return false;

  // Busy kinds share a persona but drive different status lines
  // (e.g. THINKING "Still waiting…" vs RESPONDING "ready"). Kind changes
  // happen a few times per run, not per delta, so this stays cheap.
  if (prev.uiState.kind !== next.uiState.kind) return false;
  if (prev.externalCliStatus !== next.externalCliStatus) return false;

  // Re-render if input-related props change
  if (
    prev.queueCount !== next.queueCount ||
    prev.queuePaused !== next.queuePaused ||
    prev.history !== next.history
  )
    return false;
  if (
    prev.onSubmit !== next.onSubmit ||
    prev.onCancel !== next.onCancel ||
    prev.onSendNow !== next.onSendNow ||
    prev.onInterrupt !== next.onInterrupt
  )
    return false;
  if (prev.value !== next.value) return false;
  if (prev.cursor !== next.cursor) return false;

  // Re-render if display props change
  if (prev.mode !== next.mode) return false;
  if (prev.model !== next.model) return false;
  if (prev.footerModelDisplay !== next.footerModelDisplay) return false;
  if (prev.reasoningLevel !== next.reasoningLevel) return false;
  if (prev.contextDisplay !== next.contextDisplay) return false;
  if (prev.planMode !== next.planMode) return false;
  if (prev.showBusyLoader !== next.showBusyLoader || prev.stopping !== next.stopping) return false;
  if (prev.tokensUsed !== next.tokensUsed) return false;

  // Re-render if layout changes
  if (prev.width !== next.width) return false;
  if (prev.layout.cols !== next.layout.cols) return false;
  if (prev.layout.rows !== next.layout.rows) return false;
  if (prev.layout.mode !== next.layout.mode) return false;
  if (prev.themeName !== next.themeName) return false;

  if (prev.modelSpec?.status !== next.modelSpec?.status) return false;
  if (prev.modelSpec?.contextWindow !== next.modelSpec?.contextWindow) return false;

  // Re-render if active provider changes (affects status line text)
  if (prev.activeProviderId !== next.activeProviderId) return false;

  // Skip re-render - streaming updates within the same uiState kind don't affect composer
  return true;
}

export const MemoizedBottomComposer = memo(BottomComposer, areBottomComposerPropsEqual);
