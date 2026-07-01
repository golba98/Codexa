import { createHash } from "node:crypto";
import * as renderDebug from "../perf/renderDebug.js";
import { resetInkOutputForFreshFrame, type InkRenderInstance } from "./inkRenderReset.js";
import { traceTerminalClear } from "./terminalControl.js";

interface ClearBoundaryStdoutLike {
  columns?: number;
  rows?: number;
}

interface TerminalClearLike {
  clearTranscript: (source: string) => void;
  clearViewport: (source: string) => void;
}

interface LogShadowState {
  previousOutputLength: number;
  previousLineCount: number;
}

interface TerminalControlSequenceStats {
  cursorUpCount: number;
  cursorHomeCount: number;
  eraseLineCount: number;
  eraseDisplayCount: number;
  carriageReturnCount: number;
}

type InkLogLike = {
  (output: string): unknown;
  clear?: () => unknown;
  sync?: (output: string) => unknown;
  reset?: () => unknown;
  willRender?: (output: string) => unknown;
  isCursorDirty?: () => unknown;
};

export interface ClearFrameBoundaryRenderState {
  generation: number;
  staticEventsLength: number;
  activeEventsLength: number;
  transcriptCleared: boolean;
  clearGenerationReady?: boolean;
  uiStateKind: string;
}

export interface ClearFrameBoundaryController {
  beginClearGeneration: (generation: number) => boolean;
  /**
   * Mirror the React render state into the boundary's gate. Returns `true` when
   * a post-clear authoritative frame is now ready to commit but hasn't been
   * written yet — the caller must force one more render so Ink's
   * renderInteractiveFrame runs again and flushes it (see app.tsx).
   */
  syncRenderState: (state: ClearFrameBoundaryRenderState) => boolean;
  getState: () => {
    clearPending: boolean;
    pendingGeneration: number | null;
    committedGeneration: number | null;
    renderGeneration: number;
    transcriptCleared: boolean;
    lastFrameWasAuthoritative: boolean;
    logShadow: LogShadowState;
  };
  dispose: () => void;
}

interface CreateClearFrameBoundaryOptions {
  instance: InkRenderInstance | null;
  terminalControl: TerminalClearLike;
  stdout: ClearBoundaryStdoutLike;
  source?: string;
  /** Injectable clock, so tests can drive the startup grace window deterministically. */
  now?: () => number;
  /**
   * Many terminals/PTYs report a provisional column/row count when a process
   * first attaches, then correct it a few milliseconds later once the real
   * size negotiation settles. Treating that early settle as a genuine
   * mid-session resize would trigger the scrollback-inclusive clear below
   * before anything has actually gone stale — and since Ink's <Static> never
   * re-emits items once flushed, that clear permanently erases whatever
   * intro/logo/system-events were already committed. Suppress the resize
   * refresh for this long after the boundary is created so real dimensions
   * can settle first; 0 in test env so existing tests are unaffected.
   */
  startupGraceMs?: number;
  /**
   * Called synchronously whenever a width-changing resize triggers the
   * scrollback-inclusive clear. The physical clear happens mid-commit, after
   * React has already decided this frame's static output, so anything
   * <Static> already flushed (the logo, past conversation turns) is erased
   * from the real terminal but never re-emitted by Ink — <Static> has no
   * concept of "the terminal was wiped out from under me." The caller must
   * use this to force a fresh render with a new <Static> key so its content
   * gets reflushed at the new width.
   */
  onWidthResizeRefresh?: () => void;
}

interface FrameMarkerCounts {
  codexaLogoCount: number;
  providerMigratedCount: number;
  launchModeCount: number;
  composerCount: number;
  footerCount: number;
}

const LOGO_LINE = /██╔════╝██╔═══██╗/g;
const PROVIDER_MIGRATED = /Provider migrated/g;
const LAUNCH_MODE = /Launch mode/g;
const COMPOSER = /│ ❯/g;
const FOOTER_CONTEXT = /Context:/g;
const ANSI_SEQUENCE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;

function stableFrameHash(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex").slice(0, 12);
}

function countMatches(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  let count = 0;
  while (pattern.exec(text)) count += 1;
  pattern.lastIndex = 0;
  return count;
}

function countFrameMarkers(text: string): FrameMarkerCounts {
  const plainText = text.replace(ANSI_SEQUENCE, "");
  return {
    codexaLogoCount: countMatches(plainText, LOGO_LINE),
    providerMigratedCount: countMatches(plainText, PROVIDER_MIGRATED),
    launchModeCount: countMatches(plainText, LAUNCH_MODE),
    composerCount: countMatches(plainText, COMPOSER),
    footerCount: countMatches(plainText, FOOTER_CONTEXT),
  };
}

function buildFrameText(instance: InkRenderInstance, output: string, staticOutput = ""): string {
  const fullStaticOutput = instance.fullStaticOutput ?? "";
  if (!staticOutput) return `${fullStaticOutput}${output}`;
  if (!fullStaticOutput || staticOutput.includes(fullStaticOutput)) {
    return `${staticOutput}${output}`;
  }
  return `${fullStaticOutput}${staticOutput}${output}`;
}

function snapshotFrameState(instance: InkRenderInstance, logShadow: LogShadowState) {
  return {
    lastOutputLength: (instance.lastOutput ?? "").length,
    lastOutputToRenderLength: (instance.lastOutputToRender ?? "").length,
    lastOutputHeight: instance.lastOutputHeight ?? 0,
    fullStaticOutputLength: (instance.fullStaticOutput ?? "").length,
    logPreviousOutputLength: logShadow.previousOutputLength,
    logPreviousLineCount: logShadow.previousLineCount,
  };
}

function lineCountForOutput(output: string): number {
  if (output.length === 0) return 0;
  return output.split("\n").length;
}

function countAnsiMatches(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  let count = 0;
  while (pattern.exec(text)) count += 1;
  pattern.lastIndex = 0;
  return count;
}

function inspectControlSequences(output: string): TerminalControlSequenceStats {
  return {
    cursorUpCount: countAnsiMatches(output, /\x1b\[[0-9]*A/g),
    cursorHomeCount: countAnsiMatches(output, /\x1b\[[0-9;]*H/g),
    eraseLineCount: countAnsiMatches(output, /\x1b\[[0-9]*K/g),
    eraseDisplayCount: countAnsiMatches(output, /\x1b\[[0-9]*J/g),
    carriageReturnCount: countAnsiMatches(output, /\r/g),
  };
}

function wrapInkLogForTrace(
  instance: InkRenderInstance,
  source: string,
  shadow: LogShadowState,
): () => void {
  const currentLog = instance.log;
  if (typeof currentLog !== "function") {
    return () => {};
  }

  const original = currentLog as InkLogLike;

  const wrapped: InkLogLike = ((output: string) => {
    const before = { ...shadow };
    const controlSequences = inspectControlSequences(output);
    const result = original(output);
    shadow.previousOutputLength = output.length;
    shadow.previousLineCount = lineCountForOutput(output);
    renderDebug.traceEvent("terminal", "inkLogWrite", {
      source,
      outputLength: output.length,
      outputHash: stableFrameHash(output),
      previousOutputLengthBefore: before.previousOutputLength,
      previousLineCountBefore: before.previousLineCount,
      previousOutputLengthAfter: shadow.previousOutputLength,
      previousLineCountAfter: shadow.previousLineCount,
      ...controlSequences,
    });
    return result;
  }) as InkLogLike;

  wrapped.clear = () => {
    const before = { ...shadow };
    const result = original.clear?.();
    shadow.previousOutputLength = 0;
    shadow.previousLineCount = 0;
    renderDebug.traceEvent("terminal", "inkLogClear", {
      source,
      previousOutputLengthBefore: before.previousOutputLength,
      previousLineCountBefore: before.previousLineCount,
      previousOutputLengthAfter: shadow.previousOutputLength,
      previousLineCountAfter: shadow.previousLineCount,
    });
    return result;
  };

  wrapped.sync = (output: string) => {
    const before = { ...shadow };
    const controlSequences = inspectControlSequences(output);
    const result = original.sync?.(output);
    shadow.previousOutputLength = output.length;
    shadow.previousLineCount = lineCountForOutput(output);
    renderDebug.traceEvent("terminal", "inkLogSync", {
      source,
      outputLength: output.length,
      previousOutputLengthBefore: before.previousOutputLength,
      previousLineCountBefore: before.previousLineCount,
      previousOutputLengthAfter: shadow.previousOutputLength,
      previousLineCountAfter: shadow.previousLineCount,
      ...controlSequences,
    });
    return result;
  };

  wrapped.reset = () => {
    const before = { ...shadow };
    const result = original.reset?.();
    shadow.previousOutputLength = 0;
    shadow.previousLineCount = 0;
    renderDebug.traceEvent("terminal", "inkLogReset", {
      source,
      previousOutputLengthBefore: before.previousOutputLength,
      previousLineCountBefore: before.previousLineCount,
      previousOutputLengthAfter: shadow.previousOutputLength,
      previousLineCountAfter: shadow.previousLineCount,
    });
    return result;
  };

  wrapped.willRender = original.willRender ? (output: string) => original.willRender?.(output) : undefined;
  wrapped.isCursorDirty = original.isCursorDirty ? () => original.isCursorDirty?.() : undefined;

  instance.log = wrapped as unknown as { reset?: () => void };

  return () => {
    instance.log = original as unknown as { reset?: () => void };
  };
}

export function createClearFrameBoundaryController({
  instance,
  terminalControl,
  stdout,
  source = "src/core/terminal/clearFrameBoundary.ts",
  now = Date.now,
  startupGraceMs = process.env.NODE_ENV === "test" ? 0 : 300,
  onWidthResizeRefresh,
}: CreateClearFrameBoundaryOptions): ClearFrameBoundaryController | null {
  const originalRenderInteractiveFrame = instance?.renderInteractiveFrame;
  if (!instance || typeof originalRenderInteractiveFrame !== "function") {
    renderDebug.traceEvent("terminal", "clearBoundaryInit", {
      source,
      liveInkInstanceResolved: Boolean(instance),
      renderInteractiveFrameResolved: false,
    });
    return null;
  }

  let clearPending = false;
  let pendingGeneration: number | null = null;
  let committedGeneration: number | null = null;
  let renderGeneration = 0;
  let transcriptCleared = false;
  let clearGenerationReady = false;
  let staticEventsLength = 0;
  let activeEventsLength = 0;
  let uiStateKind = "IDLE";
  let lastFrameWasAuthoritative = false;
  let previousCols = stdout.columns;
  let previousRows = stdout.rows;
  const createdAt = now();
  const logShadow: LogShadowState = { previousOutputLength: 0, previousLineCount: 0 };

  const restoreLog = wrapInkLogForTrace(instance, source, logShadow);
  const boundOriginal = originalRenderInteractiveFrame.bind(instance);

  const isPostClearFrameReady = (): boolean => {
    if (!clearPending || pendingGeneration === null) return false;
    return renderGeneration >= pendingGeneration && (transcriptCleared || clearGenerationReady);
  };

  instance.renderInteractiveFrame = (output: string, outputHeight: number, staticOutput: string) => {
    const currentCols = stdout.columns;
    const currentRows = stdout.rows;
    const widthChanged = previousCols !== currentCols;
    const resizeDetected = widthChanged || previousRows !== currentRows;
    const postClearReady = isPostClearFrameReady();
    const isFirstPostClearCommit = clearPending && postClearReady;
    // Any terminal *width* change reflows the previously-rendered frame; a diffed
    // write (Ink's height-only diff) would leave that reflowed frame stacked behind
    // the new one — GNOME Terminal keeps it in scrollback on a grow and re-exposes
    // it. Repaint authoritatively from a scrollback-clean baseline on every width
    // change, using the same primitive /clear uses. Skip while a clear is still
    // pending: that path owns the next authoritative frame.
    const withinStartupGrace = now() - createdAt < startupGraceMs;
    const isWidthResizeRefresh = widthChanged && !clearPending && !isFirstPostClearCommit && !withinStartupGrace;
    const frameClassification = isFirstPostClearCommit
      ? "post-clear"
      : (isWidthResizeRefresh ? "resize-refresh" : (clearPending ? "pre-clear" : "normal"));
    const staleFrameSuppressed = clearPending && !postClearReady;
    const frameWriteAllowed = !staleFrameSuppressed;
    const isAuthoritativeFrame = isFirstPostClearCommit || isWidthResizeRefresh;
    const frameText = isAuthoritativeFrame ? `${staticOutput}${output}` : buildFrameText(instance, output, staticOutput);
    const markerCounts = countFrameMarkers(frameText);
    const frameHash = stableFrameHash(frameText);
    const clearGenerationUsed = isFirstPostClearCommit ? pendingGeneration : committedGeneration;
    const before = snapshotFrameState(instance, logShadow);

    if (resizeDetected) {
      renderDebug.traceEvent("terminal", "resizeAfterClear", {
        previousCols,
        previousRows,
        currentCols,
        currentRows,
        widthChanged,
        clearPending,
        pendingGeneration,
        committedGeneration,
        renderGeneration,
        transcriptCleared,
        frameClassification,
        resizeRefreshApplied: isWidthResizeRefresh,
        resizeFramePath: isWidthResizeRefresh ? "full-authoritative" : "diffed",
        clearGenerationUsed,
        previousLineCountBefore: before.logPreviousLineCount,
        lastOutputHeightBefore: before.lastOutputHeight,
      });
      previousCols = currentCols;
      previousRows = currentRows;
    }

    renderDebug.traceEvent("terminal", "clearBoundaryFrame", {
      clearPending,
      pendingGeneration,
      committedGeneration,
      renderGeneration,
      transcriptCleared,
      staticEventsLength,
      activeEventsLength,
      uiStateKind,
      frameClassification,
      isPostClearFrame: postClearReady,
      staleFrameSuppressed,
      frameWriteAllowed,
      widthChanged,
      currentCols,
      currentRows,
      resizeRefreshApplied: isWidthResizeRefresh,
      resizeFramePath: isAuthoritativeFrame ? "full-authoritative" : "diffed",
      clearGenerationUsed,
      frameLength: frameText.length,
      frameHash,
      ...markerCounts,
      ...before,
      previousLineCountBefore: before.logPreviousLineCount,
      lastOutputHeightBefore: before.lastOutputHeight,
      physicalClearImmediatelyBeforeFrame: isAuthoritativeFrame,
    });

    if (staleFrameSuppressed) {
      return;
    }

    if (isFirstPostClearCommit) {
      traceTerminalClear(`${source}:firstPostClearFrame`, {
        mode: "transcript",
        clearGeneration: pendingGeneration,
      });
      terminalControl.clearTranscript(`${source}:firstPostClearFrame`);

      const resetRan = resetInkOutputForFreshFrame({
        instance,
        columns: stdout.columns,
      });
      renderDebug.traceEvent("terminal", "clearBoundaryCommit", {
        clearGeneration: pendingGeneration,
        physicalTerminalClearEmitted: true,
        inkCacheResetAttempted: true,
        inkCacheResetEmitted: resetRan,
        liveInkInstanceResolved: true,
        before,
        afterReset: snapshotFrameState(instance, logShadow),
      });
      lastFrameWasAuthoritative = true;
    } else if (isWidthResizeRefresh) {
      // Use the scrollback-inclusive transcript clear (not a viewport-only clear):
      // a width grow re-exposes the pre-resize frame from scrollback, so it must be
      // erased from history too — matching the proven /clear repaint.
      traceTerminalClear(`${source}:resizeRefresh`, {
        mode: "transcript",
        clearGeneration: committedGeneration,
      });
      terminalControl.clearTranscript(`${source}:resizeRefresh`);
      const resetRan = resetInkOutputForFreshFrame({
        instance,
        columns: stdout.columns,
      });
      renderDebug.traceEvent("terminal", "resizeRefreshRecovery", {
        clearGeneration: committedGeneration,
        currentCols,
        physicalTranscriptClearEmitted: true,
        inkCacheResetAttempted: true,
        inkCacheResetEmitted: resetRan,
        liveInkInstanceResolved: true,
        before,
        afterReset: snapshotFrameState(instance, logShadow),
      });
      lastFrameWasAuthoritative = true;
      // previousCols/previousRows are already updated above, so this callback
      // fires exactly once per genuine width change, not on every subsequent
      // commit. The caller must force a fresh <Static> instance so its
      // already-flushed content (logo, past turns) gets reprinted at the new
      // width — this physical clear just erased it and Ink won't redo that on
      // its own.
      onWidthResizeRefresh?.();
    } else {
      lastFrameWasAuthoritative = false;
    }

    boundOriginal(output, outputHeight, staticOutput);

    const after = snapshotFrameState(instance, logShadow);
    renderDebug.traceEvent("terminal", "clearBoundaryFrameCommitted", {
      clearPending,
      pendingGeneration,
      committedGeneration,
      renderGeneration,
      transcriptCleared,
      frameClassification: isFirstPostClearCommit ? "post-clear-authoritative" : frameClassification,
      frameLength: frameText.length,
      frameHash,
      ...markerCounts,
      ...after,
      diffedFrame: !isAuthoritativeFrame,
      fullAuthoritativeFrame: isAuthoritativeFrame,
      widthChanged,
      currentCols,
      currentRows,
      resizeRefreshApplied: isWidthResizeRefresh,
      resizeFramePath: isAuthoritativeFrame ? "full-authoritative" : "diffed",
      clearGenerationUsed,
      previousLineCountAfter: after.logPreviousLineCount,
      lastOutputHeightAfter: after.lastOutputHeight,
      physicalClearImmediatelyBeforeFrame: isAuthoritativeFrame,
    });

    if (isFirstPostClearCommit) {
      committedGeneration = pendingGeneration;
      clearPending = false;
      pendingGeneration = null;
      renderDebug.traceEvent("terminal", "firstCommittedPostClearFrame", {
        committedGeneration,
        frameHash,
        firstFrameAuthoritative: true,
        ...markerCounts,
      });
    } else if (isWidthResizeRefresh) {
      renderDebug.traceEvent("terminal", "resizeRefreshCommitted", {
        committedGeneration,
        currentCols,
        resizeRefreshConsumed: true,
        frameHash,
        ...markerCounts,
      });
    }
  };

  renderDebug.traceEvent("terminal", "clearBoundaryInit", {
    source,
    liveInkInstanceResolved: true,
    renderInteractiveFrameResolved: true,
  });

  return {
    beginClearGeneration(generation) {
      if (!Number.isFinite(generation)) return false;
      clearPending = true;
      pendingGeneration = generation;
      renderDebug.traceEvent("terminal", "clearBoundaryBegin", {
        clearGeneration: generation,
        clearPending,
        renderGeneration,
        transcriptCleared,
        staticEventsLength,
        activeEventsLength,
        uiStateKind,
        before: {
          lastOutputLength: (instance.lastOutput ?? "").length,
          lastOutputToRenderLength: (instance.lastOutputToRender ?? "").length,
          lastOutputHeight: instance.lastOutputHeight ?? 0,
          fullStaticOutputLength: (instance.fullStaticOutput ?? "").length,
          logPreviousOutputLength: logShadow.previousOutputLength,
          logPreviousLineCount: logShadow.previousLineCount,
        },
      });
      return true;
    },
    syncRenderState(state) {
      if (!Number.isFinite(state.generation)) return false;
      renderGeneration = state.generation;
      transcriptCleared = state.transcriptCleared;
      clearGenerationReady = state.clearGenerationReady === true;
      staticEventsLength = state.staticEventsLength;
      activeEventsLength = state.activeEventsLength;
      uiStateKind = state.uiStateKind;
      // Ink writes a frame during the React commit (resetAfterCommit), which runs
      // BEFORE the passive effect that calls this. So the cleared frame's
      // renderInteractiveFrame already ran (and was suppressed) against the stale
      // gate. When the gate is now satisfiable, signal the host to force exactly
      // one more render so the authoritative post-clear frame is flushed.
      const postClearRepaintPending = clearPending && isPostClearFrameReady();
      renderDebug.traceEvent("terminal", "clearBoundaryRenderState", {
        renderGeneration,
        transcriptCleared,
        clearGenerationReady,
        staticEventsLength,
        activeEventsLength,
        uiStateKind,
        clearPending,
        pendingGeneration,
        committedGeneration,
        postClearRepaintPending,
      });
      return postClearRepaintPending;
    },
    getState() {
      return {
        clearPending,
        pendingGeneration,
        committedGeneration,
        renderGeneration,
        transcriptCleared,
        lastFrameWasAuthoritative,
        logShadow: { ...logShadow },
      };
    },
    dispose() {
      instance.renderInteractiveFrame = originalRenderInteractiveFrame;
      restoreLog();
    },
  };
}
