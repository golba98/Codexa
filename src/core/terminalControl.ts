import * as renderDebug from "./perf/renderDebug.js";

export const TERMINAL_TITLE = "CODEXA";

export const TERMINAL_SEQUENCES = {
  // \x1b[2J clears the visible viewport; \x1b[3J clears scrollback.
  hardRepaint: "\x1b[2J\x1b[3J\x1b[H",
  viewportClear: "\x1b[2J\x1b[H",
  bracketedPasteEnable: "\x1b[?2004h",
  bracketedPasteDisable: "\x1b[?2004l",
  mouseEnable: "\x1b[?1000h\x1b[?1006h",
  mouseDisable: "\x1b[?1000l\x1b[?1006l",
  title: "\x1b]0;CODEXA\x07\x1b]2;CODEXA\x07",
} as const;

export type TerminalWrite = (chunk: string) => boolean | void;
export type TerminalChannel = "stdout" | "stderr";

// Tracks current UI state kind for diagnostic assertions.
let currentUIStateKind: string = "IDLE";

export function setTerminalControlUIState(kind: string): void {
  currentUIStateKind = kind;
}

export function writeTerminalControl(
  write: TerminalWrite,
  channel: TerminalChannel,
  source: string,
  sequence: string,
): boolean {
  renderDebug.traceTerminalWrite(channel, source, sequence);

  // Diagnostic: warn if a viewport-clearing sequence fires during streaming.
  if (
    renderDebug.isRenderDebugEnabled()
    && (currentUIStateKind === "RESPONDING" || currentUIStateKind === "THINKING")
    && (sequence.includes("\x1b[2J") || sequence.includes("\x1b[3J"))
  ) {
    renderDebug.traceEvent("terminal", "unexpectedClearDuringStreaming", {
      source,
      uiStateKind: currentUIStateKind,
      sequenceLength: sequence.length,
    });
  }

  return write(sequence) !== false;
}

export function traceTerminalClear(source: string, fields: Record<string, unknown>): void {
  renderDebug.traceTerminalClear(source, fields);
}

export interface TerminalModeController {
  write(sequence: string, source: string): boolean;
  setMouseReporting(enabled: boolean, source: string): void;
  setBracketedPaste(enabled: boolean, source: string): void;
  resetModes(): void;
}

export function createTerminalModeController(write: TerminalWrite): TerminalModeController {
  let mouseReporting: boolean | null = null;
  let bracketedPaste: boolean | null = null;

  const writeStdout = (sequence: string, source: string) =>
    writeTerminalControl(write, "stdout", source, sequence);

  return {
    write: writeStdout,
    setMouseReporting(enabled, source) {
      if (mouseReporting === enabled) return;
      mouseReporting = enabled;
      writeStdout(enabled ? TERMINAL_SEQUENCES.mouseEnable : TERMINAL_SEQUENCES.mouseDisable, source);
    },
    setBracketedPaste(enabled, source) {
      if (bracketedPaste === enabled) return;
      bracketedPaste = enabled;
      writeStdout(enabled ? TERMINAL_SEQUENCES.bracketedPasteEnable : TERMINAL_SEQUENCES.bracketedPasteDisable, source);
    },
    resetModes() {
      mouseReporting = null;
      bracketedPaste = null;
    },
  };
}
