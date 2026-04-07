/**
 * Run orchestrator — main coordination controller for staged response pipeline.
 * Connects task classification, preflight scanning, Codex execution, and section parsing.
 */

import type { AvailableBackend, AvailableMode, AvailableModel, ReasoningLevel } from "../config/settings.js";
import type { RunToolActivity } from "../session/types.js";
import {
  createRunStartEvent,
  createStatusEvent,
  createRunCompleteEvent,
  createRunFailedEvent,
  createRunCanceledEvent,
  createToolStartEvent,
  createToolDoneEvent,
  type TaskType,
  type UIEvent,
} from "./events.js";
import { EventDispatcher, createRunDispatcher, type PanelStateListener } from "./eventDispatcher.js";
import { createInitialPanelState, type PanelState } from "./panelState.js";
import { runPreflightScan, type ScoredFile } from "./preflightScanner.js";
import { createHybridParser } from "./sectionParser.js";
import { classifyTask, getTaskFlowConfig, getTaskStartMessage } from "./taskClassifier.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrchestratorOptions {
  workspaceRoot: string;
  model: AvailableModel;
  mode: AvailableMode;
  reasoningLevel: ReasoningLevel;
  /** External event listener (for integration with app state) */
  onEvent?: (event: UIEvent) => void;
  /** External panel state listener */
  onStateChange?: (state: PanelState) => void;
}

export interface RunContext {
  prompt: string;
  taskType: TaskType;
  relevantFiles: ScoredFile[];
  startedAt: number;
}

export interface BackendCallbacks {
  onResponse: (response: string) => void;
  onError: (message: string, rawOutput?: string) => void;
  onProgress?: (line: string) => void;
  onAssistantDelta?: (chunk: string) => void;
  onToolActivity?: (activity: RunToolActivity) => void;
}

export type BackendRunner = (
  prompt: string,
  options: {
    model: AvailableModel;
    mode: AvailableMode;
    reasoningLevel: ReasoningLevel;
    workspaceRoot: string;
  },
  callbacks: BackendCallbacks,
) => () => void;

// ─── Run Orchestrator Class ───────────────────────────────────────────────────

export class RunOrchestrator {
  private readonly options: OrchestratorOptions;
  private readonly dispatcher: EventDispatcher;
  private runContext: RunContext | null = null;
  private cancelFn: (() => void) | null = null;
  private isRunning = false;

  constructor(options: OrchestratorOptions) {
    this.options = options;
    this.dispatcher = createRunDispatcher();

    // Wire up external listeners
    if (options.onEvent) {
      const handler = options.onEvent;
      this.dispatcher.subscribe((_state, event) => handler(event));
    }

    if (options.onStateChange) {
      const handler = options.onStateChange;
      this.dispatcher.subscribe((state) => handler(state));
    }
  }

  // ─── Public Interface ───────────────────────────────────────────────────────

  /**
   * Start a new orchestrated run.
   */
  async startRun(prompt: string, backendRunner: BackendRunner): Promise<void> {
    if (this.isRunning) {
      throw new Error("A run is already in progress");
    }

    this.isRunning = true;
    const startedAt = Date.now();

    try {
      // 1. Classify task
      const taskType = classifyTask(prompt);
      const flowConfig = getTaskFlowConfig(taskType);
      const startMessage = getTaskStartMessage(taskType);

      // Emit run start
      this.dispatcher.dispatch(createRunStartEvent(taskType, startMessage));
      this.dispatcher.dispatch({ type: "run:phase", phase: "classifying" });

      // 2. Run preflight scan if configured
      let relevantFiles: ScoredFile[] = [];

      if (flowConfig.preflightScan) {
        this.dispatcher.dispatch({ type: "run:phase", phase: "preflight" });
        this.dispatcher.dispatch(createStatusEvent("Scanning workspace for relevant files..."));

        if (flowConfig.showThinking) {
          this.dispatcher.dispatch({ type: "thinking:start", title: "Analyzing workspace..." });
        }

        relevantFiles = await runPreflightScan({
          rootDir: this.options.workspaceRoot,
          prompt,
          taskType,
          maxFiles: 15,
          onEvent: (event) => this.dispatcher.dispatch(event),
        });

        if (flowConfig.showThinking && relevantFiles.length > 0) {
          this.dispatcher.dispatch({
            type: "thinking:update",
            summary: `Found ${relevantFiles.length} relevant file${relevantFiles.length === 1 ? "" : "s"}`,
          });
        }
      }

      // 3. Store run context
      this.runContext = {
        prompt,
        taskType,
        relevantFiles,
        startedAt,
      };

      // 4. Update status and start processing
      this.dispatcher.dispatch({ type: "run:phase", phase: "processing" });
      this.dispatcher.dispatch(createStatusEvent("Sending request to Codexa..."));

      // 5. Create hybrid parser for response
      const parser = createHybridParser({
        onEvent: (event) => this.dispatcher.dispatch(event),
        onRawContent: (content) => {
          this.dispatcher.dispatch({ type: "assistant:partial", content: content + "\n" });
        },
      });

      // 6. Execute backend
      await new Promise<void>((resolve, reject) => {
        let hasReceivedContent = false;

        this.cancelFn = backendRunner(
          this.buildEnhancedPrompt(prompt, relevantFiles),
          {
            model: this.options.model,
            mode: this.options.mode,
            reasoningLevel: this.options.reasoningLevel,
            workspaceRoot: this.options.workspaceRoot,
          },
          {
            onResponse: (response) => {
              // Flush parser and finalize
              parser.flush();

              const durationMs = Date.now() - startedAt;
              const filesModified = this.dispatcher.getState().filesModified;

              // If we haven't dispatched content yet, send final
              if (!hasReceivedContent && response.trim()) {
                this.dispatcher.dispatch({ type: "assistant:final", content: response });
              }

              this.dispatcher.dispatch({ type: "thinking:done" });
              this.dispatcher.dispatch(createRunCompleteEvent(durationMs, filesModified));
              resolve();
            },

            onError: (message, rawOutput) => {
              parser.flush();
              this.dispatcher.dispatch(createRunFailedEvent(message));
              reject(new Error(message));
            },

            onProgress: (line) => {
              // Route to thinking panel
              if (line.trim()) {
                this.dispatcher.dispatch({ type: "thinking:update", summary: line });
              }
            },

            onAssistantDelta: (chunk) => {
              if (!hasReceivedContent && chunk.trim()) {
                hasReceivedContent = true;
                this.dispatcher.dispatch({ type: "run:phase", phase: "responding" });
                this.dispatcher.dispatch(createStatusEvent("Receiving response..."));
              }

              // Feed to parser for structured handling
              parser.feed(chunk);
            },

            onToolActivity: (activity) => {
              if (activity.status === "running") {
                this.dispatcher.dispatch(
                  createToolStartEvent(activity.id, "shell", activity.command),
                );
              } else {
                this.dispatcher.dispatch(
                  createToolDoneEvent(activity.id, activity.status, activity.summary ?? undefined),
                );
              }
            },
          },
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.dispatcher.dispatch(createRunFailedEvent(message));
      throw error;
    } finally {
      this.isRunning = false;
      this.cancelFn = null;
      this.dispatcher.flush();
    }
  }

  /**
   * Cancel the current run.
   */
  cancel(): void {
    if (!this.isRunning) return;

    this.cancelFn?.();
    this.dispatcher.dispatch(createRunCanceledEvent());
    this.isRunning = false;
    this.cancelFn = null;
  }

  /**
   * Get current panel state.
   */
  getState(): PanelState {
    return this.dispatcher.getState();
  }

  /**
   * Get current run context.
   */
  getRunContext(): RunContext | null {
    return this.runContext;
  }

  /**
   * Check if a run is active.
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Subscribe to state changes.
   */
  subscribe(listener: (state: PanelState) => void): () => void {
    return this.dispatcher.subscribe((state, _event) => listener(state));
  }

  /**
   * Wait for the current run to complete.
   * Returns a promise that resolves when the run finishes (complete, failed, or canceled).
   */
  waitForCompletion(): Promise<PanelState> {
    return new Promise((resolve) => {
      if (!this.isRunning) {
        resolve(this.getState());
        return;
      }

      const unsubscribe = this.dispatcher.subscribe((state, _event) => {
        if (
          state.runPhase === "complete" ||
          state.runPhase === "failed" ||
          state.runPhase === "canceled"
        ) {
          unsubscribe();
          resolve(state);
        }
      });
    });
  }

  /**
   * Reset orchestrator state.
   */
  reset(): void {
    this.cancel();
    this.dispatcher.reset();
    this.runContext = null;
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.cancel();
    this.dispatcher.destroy();
  }

  // ─── Private Methods ────────────────────────────────────────────────────────

  /**
   * Build enhanced prompt with file context and structured output instructions.
   */
  private buildEnhancedPrompt(prompt: string, relevantFiles: ScoredFile[]): string {
    const parts: string[] = [];

    // Original prompt
    parts.push(prompt);

    // Add relevant file context if available
    if (relevantFiles.length > 0) {
      parts.push("");
      parts.push("---");
      parts.push("Relevant files in the workspace:");
      for (const file of relevantFiles.slice(0, 10)) {
        const reason = file.reason ? ` (${file.reason})` : "";
        parts.push(`- ${file.relativePath}${reason}`);
      }
    }

    // Add structured output instructions
    parts.push("");
    parts.push("---");
    parts.push("Format your response with the following structure when applicable:");
    parts.push("[STATUS] Brief status message about what you're doing");
    parts.push("[THINKING] Brief summary of your analysis approach");
    parts.push("[ANALYSIS] Your detailed analysis");
    parts.push("[SUGGESTION] Specific suggestions or improvements");
    parts.push("[DIFF:filename] Code changes in diff format");
    parts.push("[COMMAND] Shell commands to run");
    parts.push("[SUMMARY] Brief summary of changes made");
    parts.push("");
    parts.push("Use these markers to structure your response for better readability.");

    return parts.join("\n");
  }
}

// ─── Factory Functions ────────────────────────────────────────────────────────

/**
 * Create a run orchestrator instance.
 */
export function createOrchestrator(options: OrchestratorOptions): RunOrchestrator {
  return new RunOrchestrator(options);
}

// ─── Simple Integration Helper ────────────────────────────────────────────────

/**
 * Simplified run function that handles orchestration internally.
 * Returns a cleanup function.
 */
export function startOrchestratedRun(
  prompt: string,
  options: OrchestratorOptions,
  backendRunner: BackendRunner,
  callbacks: {
    onStateChange?: (state: PanelState) => void;
    onComplete?: (state: PanelState) => void;
    onError?: (error: Error) => void;
  } = {},
): () => void {
  const orchestrator = createOrchestrator({
    ...options,
    onStateChange: (state) => {
      callbacks.onStateChange?.(state);

      // Check for completion
      if (state.runPhase === "complete") {
        callbacks.onComplete?.(state);
      }
    },
  });

  orchestrator
    .startRun(prompt, backendRunner)
    .then(() => {
      // Already handled via onStateChange
    })
    .catch((error) => {
      callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
    });

  return () => orchestrator.cancel();
}
