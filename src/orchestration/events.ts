/**
 * UIEvent discriminated union — the core event model for the staged rendering pipeline.
 * All pipeline stages communicate via these strongly-typed events.
 */

// ─── Task Classification ──────────────────────────────────────────────────────

export type TaskType =
  | "code-suggest"
  | "code-review"
  | "bug-fix"
  | "refactor"
  | "explain"
  | "feature"
  | "general";

// ─── File Inspection ──────────────────────────────────────────────────────────

export type FileInspectionStatus = "queued" | "reading" | "analyzed" | "done" | "skipped";

// ─── Tool Activity ────────────────────────────────────────────────────────────

export type ToolActivityStatus = "running" | "completed" | "failed";

// ─── Run Phases ───────────────────────────────────────────────────────────────

export type RunPhase =
  | "idle"
  | "classifying"
  | "preflight"
  | "processing"
  | "responding"
  | "complete"
  | "failed"
  | "canceled";

// ─── Result Sections ──────────────────────────────────────────────────────────

export type ResultSectionType =
  | "intro"
  | "analysis"
  | "suggestion"
  | "implementation"
  | "summary"
  | "explanation";

// ─── UIEvent Discriminated Union ──────────────────────────────────────────────

export type UIEvent =
  // Run lifecycle
  | { type: "run:start"; taskType: TaskType; message: string; timestamp: number }
  | { type: "run:phase"; phase: RunPhase }
  | { type: "run:complete"; durationMs: number; filesModified: number }
  | { type: "run:failed"; error: string }
  | { type: "run:canceled" }

  // Status panel
  | { type: "status"; message: string }
  | { type: "status:clear" }

  // Thinking/progress panel
  | { type: "thinking:start"; title?: string }
  | { type: "thinking:update"; summary: string }
  | { type: "thinking:done" }

  // Files inspection panel
  | { type: "files:start"; title?: string; estimatedCount?: number }
  | {
      type: "files:item";
      path: string;
      status: FileInspectionStatus;
      relevance?: number;
      reason?: string;
    }
  | { type: "files:done"; totalCount: number }

  // Tool/activity panel
  | { type: "tool:start"; id: string; name: string; command?: string }
  | { type: "tool:update"; id: string; message: string; progress?: number }
  | { type: "tool:done"; id: string; status: ToolActivityStatus; summary?: string }

  // Assistant result panel
  | { type: "assistant:section"; section: ResultSectionType; content: string }
  | { type: "assistant:partial"; content: string }
  | { type: "assistant:final"; content: string }
  | { type: "assistant:clear" }

  // Diff panel
  | { type: "diff:start"; file: string }
  | { type: "diff:content"; file: string; patch: string; language?: string }
  | { type: "diff:done"; file: string }

  // Command panel
  | { type: "command"; content: string; description?: string; copyable?: boolean }

  // Warnings and errors
  | { type: "warning"; message: string }
  | { type: "error"; message: string };

// ─── Event Utilities ──────────────────────────────────────────────────────────

export function isRunLifecycleEvent(event: UIEvent): boolean {
  return event.type.startsWith("run:");
}

export function isStatusEvent(event: UIEvent): boolean {
  return event.type === "status" || event.type === "status:clear";
}

export function isThinkingEvent(event: UIEvent): boolean {
  return event.type.startsWith("thinking:");
}

export function isFilesEvent(event: UIEvent): boolean {
  return event.type.startsWith("files:");
}

export function isToolEvent(event: UIEvent): boolean {
  return event.type.startsWith("tool:");
}

export function isAssistantEvent(event: UIEvent): boolean {
  return event.type.startsWith("assistant:");
}

export function isDiffEvent(event: UIEvent): boolean {
  return event.type.startsWith("diff:");
}

export function createTimestamp(): number {
  return Date.now();
}

// ─── Event Factories ──────────────────────────────────────────────────────────

export function createRunStartEvent(taskType: TaskType, message: string): UIEvent {
  return { type: "run:start", taskType, message, timestamp: createTimestamp() };
}

export function createStatusEvent(message: string): UIEvent {
  return { type: "status", message };
}

export function createThinkingUpdateEvent(summary: string): UIEvent {
  return { type: "thinking:update", summary };
}

export function createFileItemEvent(
  path: string,
  status: FileInspectionStatus,
  options?: { relevance?: number; reason?: string },
): UIEvent {
  return { type: "files:item", path, status, ...options };
}

export function createToolStartEvent(id: string, name: string, command?: string): UIEvent {
  return { type: "tool:start", id, name, command };
}

export function createToolDoneEvent(
  id: string,
  status: ToolActivityStatus,
  summary?: string,
): UIEvent {
  return { type: "tool:done", id, status, summary };
}

export function createAssistantPartialEvent(content: string): UIEvent {
  return { type: "assistant:partial", content };
}

export function createAssistantFinalEvent(content: string): UIEvent {
  return { type: "assistant:final", content };
}

export function createDiffEvent(file: string, patch: string, language?: string): UIEvent {
  return { type: "diff:content", file, patch, language };
}

export function createCommandEvent(
  content: string,
  description?: string,
  copyable = true,
): UIEvent {
  return { type: "command", content, description, copyable };
}

export function createWarningEvent(message: string): UIEvent {
  return { type: "warning", message };
}

export function createErrorEvent(message: string): UIEvent {
  return { type: "error", message };
}

export function createRunCompleteEvent(durationMs: number, filesModified: number): UIEvent {
  return { type: "run:complete", durationMs, filesModified };
}

export function createRunFailedEvent(error: string): UIEvent {
  return { type: "run:failed", error };
}

export function createRunCanceledEvent(): UIEvent {
  return { type: "run:canceled" };
}
