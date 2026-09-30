import { randomUUID } from "node:crypto";
import type { TimelineEvent, UIState } from "./types.js";
import type { PlanFlowState } from "./planFlow.js";
import type { ProviderImageAttachment } from "../core/providerRuntime/types.js";
import type { FileCheckpoint } from "../core/workspace/checkpoints.js";

export interface QueuedPrompt {
  id: string;
  display: string;
  submitted: string;
  images: ProviderImageAttachment[];
  createdAt: number;
}
export interface FileAttachment { path: string; content?: string; hash?: string }
export interface WorkbenchSnapshot {
  version: 1;
  events: TimelineEvent[];
  uiState: UIState;
  plan: PlanFlowState;
  draft: string;
  cursor: number;
  history: string[];
  pastes: [string, string[]][];
  images: [string, ProviderImageAttachment][];
  files: [string, FileAttachment][];
  queue: QueuedPrompt[];
  checkpoints: FileCheckpoint[];
  restoredFileBoundary?: import("../core/workspace/checkpoints.js").FileBoundary;
}
export function queuedPrompt(display: string, submitted: string, images: readonly ProviderImageAttachment[] = []): QueuedPrompt {
  return { id: randomUUID(), display, submitted, images: [...images], createdAt: Date.now() };
}

/** Scheduling is independent of React commits, so duplicate effects cannot dispatch twice. */
export class PromptQueue {
  items: QueuedPrompt[] = [];
  paused = false;
  private dispatching = false;
  push(item: QueuedPrompt): void { this.items = [...this.items, item]; }
  remove(id: string): void { this.items = this.items.filter((item) => item.id !== id); }
  move(id: string, direction: number): void {
    const index = this.items.findIndex((item) => item.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= this.items.length) return;
    const items = [...this.items];
    [items[index], items[next]] = [items[next]!, items[index]!];
    this.items = items;
  }
  restore(items: QueuedPrompt[]): void { this.items = [...items]; this.paused = true; }
  async drain(start: (item: QueuedPrompt) => boolean | Promise<boolean>, ready?: () => Promise<boolean>): Promise<boolean> {
    if (this.paused || this.dispatching || !this.items.length) return false;
    this.dispatching = true;
    try {
      if (ready && !await ready()) return false;
      if (this.paused || !this.items.length) return false;
      const item = this.items[0]!;
      if (!await start(item)) { this.paused = true; return false; }
      this.remove(item.id);
      return true;
    } catch (error) { this.paused = true; throw error; } finally { this.dispatching = false; }
  }
}

function record(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function image(value: unknown): value is ProviderImageAttachment {
  return record(value) && typeof value.path === "string" && typeof value.name === "string" && typeof value.mediaType === "string";
}
function boundary(value: unknown): boolean {
  return record(value) && typeof value.complete === "boolean" && strings(value.skipped) && record(value.files)
    && Object.values(value.files).every((file) => record(file) && typeof file.hash === "string" && /^[a-f0-9]{64}$/.test(file.hash) && Number.isInteger(file.mode) && file.mode >= 0 && file.mode <= 0o777);
}
function chunkBlock(value: unknown): boolean {
  return record(value) && typeof value.id === "string" && strings(value.chunks) && ["active", "completed"].includes(value.status);
}
function runtime(value: unknown): boolean {
  return record(value) && typeof value.provider === "string" && typeof value.model === "string"
    && typeof value.reasoningLevel === "string" && typeof value.mode === "string" && typeof value.planMode === "boolean"
    && record(value.policy) && typeof value.policy.approvalPolicy === "string" && typeof value.policy.sandboxMode === "string"
    && typeof value.policy.networkAccess === "boolean" && strings(value.policy.writableRoots)
    && typeof value.policy.serviceTier === "string" && typeof value.policy.personality === "string";
}
function event(value: unknown): value is TimelineEvent {
  if (!record(value) || !Number.isInteger(value.id) || typeof value.createdAt !== "number") return false;
  switch (value.type) {
    case "user": return typeof value.prompt === "string" && Number.isInteger(value.turnId);
    case "assistant": return typeof value.content === "string" && Array.isArray(value.contentChunks) && value.contentChunks.every((v: unknown) => typeof v === "string") && Number.isInteger(value.turnId);
    case "system": case "error": return typeof value.title === "string" && typeof value.content === "string";
    case "shell": return typeof value.command === "string" && strings(value.lines) && strings(value.stderrLines) && ["running", "completed", "failed"].includes(value.status);
    case "run": return Number.isInteger(value.turnId) && runtime(value.runtime)
      && typeof value.backendLabel === "string" && typeof value.prompt === "string" && ["running", "completed", "failed", "canceled"].includes(value.status)
      && Array.isArray(value.toolActivities) && value.toolActivities.every((tool: unknown) => record(tool) && typeof tool.id === "string" && typeof tool.command === "string" && (tool.summary == null || typeof tool.summary === "string") && ["running", "completed", "failed"].includes(tool.status) && (tool.output === undefined || typeof tool.output === "string"))
      && Array.isArray(value.activity) && value.activity.every((item: unknown) => record(item) && typeof item.path === "string" && ["created", "modified", "deleted"].includes(item.operation) && (item.diffLines === undefined || (Array.isArray(item.diffLines) && item.diffLines.every((line: unknown) => record(line) && ["added", "removed"].includes(line.kind) && typeof line.text === "string"))))
      && Array.isArray(value.progressEntries) && value.progressEntries.every((item: unknown) => record(item) && typeof item.id === "string" && typeof item.text === "string" && Array.isArray(item.blocks) && item.blocks.every((block: unknown) => record(block) && typeof block.id === "string" && typeof block.text === "string"))
      && (value.responseSegments === undefined || (Array.isArray(value.responseSegments) && value.responseSegments.every(chunkBlock)))
      && (value.streamItems === undefined || (Array.isArray(value.streamItems) && value.streamItems.every((item: unknown) => record(item) && typeof item.refId === "string" && Number.isInteger(item.streamSeq))))
      && (!value.plan || chunkBlock(value.plan)) && typeof value.summary === "string";
    default: return false;
  }
}
export function parseWorkbench(value: unknown): WorkbenchSnapshot | undefined {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.events) || !value.events.every(event)) return undefined;
  if (typeof value.draft !== "string" || !Number.isInteger(value.cursor) || value.cursor < 0 || value.cursor > value.draft.length || !Array.isArray(value.history) || !value.history.every((v: unknown) => typeof v === "string")) return undefined;
  for (const key of ["pastes", "images", "files"] as const) {
    if (!Array.isArray(value[key]) || !value[key].every((v: unknown) => Array.isArray(v) && typeof v[0] === "string" && v.length === 2)) return undefined;
  }
  if (!value.pastes.every((v: any[]) => Array.isArray(v[1]) && v[1].every((text: unknown) => typeof text === "string"))) return undefined;
  if (!value.images.every((v: any[]) => image(v[1]))) return undefined;
  if (!value.files.every((v: any[]) => record(v[1]) && typeof v[1].path === "string" && (v[1].content === undefined || typeof v[1].content === "string"))) return undefined;
  if (!Array.isArray(value.queue) || !value.queue.every((v: unknown) => record(v) && typeof v.id === "string" && typeof v.display === "string" && typeof v.submitted === "string" && typeof v.createdAt === "number" && Array.isArray(v.images) && v.images.every(image))) return undefined;
  if (!Array.isArray(value.checkpoints) || !value.checkpoints.every((v: unknown) => record(v) && typeof v.id === "string" && Number.isInteger(v.turnId) && Number.isInteger(v.messageCount) && v.messageCount >= 0 && typeof v.prompt === "string" && (v.recoveryInvalidated === undefined || typeof v.recoveryInvalidated === "boolean") && boundary(v.before) && (v.after === undefined || boundary(v.after)))) return undefined;
  if (value.restoredFileBoundary !== undefined && !boundary(value.restoredFileBoundary)) return undefined;
  const safeUI: UIState = record(value.uiState) && value.uiState.kind === "AWAITING_USER_ACTION" && typeof value.uiState.question === "string" && Number.isInteger(value.uiState.turnId)
    ? value.uiState as UIState : { kind: "IDLE" };
  const plan = record(value.plan) && ["awaiting_action", "collecting_feedback"].includes(value.plan.kind)
    && typeof value.plan.currentPlan === "string" && typeof value.plan.originalPrompt === "string" && strings(value.plan.constraints) && ["suggest", "auto-edit", "full-auto"].includes(value.plan.executionMode) && (value.plan.planFilePath === null || typeof value.plan.planFilePath === "string") && (value.plan.kind !== "collecting_feedback" || ["revise", "constraints"].includes(value.plan.mode))
    ? value.plan as PlanFlowState : { kind: "idle" } as const;
  return { ...value, uiState: safeUI, plan } as WorkbenchSnapshot;
}

export function restoredEvents(events: readonly TimelineEvent[]): TimelineEvent[] {
  return events.map((entry) => {
    if (entry.type === "assistant") return { ...entry, content: entry.contentChunks.length ? entry.contentChunks.join("") : entry.content, contentChunks: [] };
    if (entry.type === "run") return {
      ...entry,
      status: entry.status === "running" ? "canceled" : entry.status,
      summary: entry.status === "running" ? "Interrupted before the session closed" : entry.summary,
      toolActivities: entry.toolActivities.map((tool) => tool.status === "running" ? { ...tool, status: "failed" as const, summary: "Interrupted" } : tool),
      progressEntries: entry.progressEntries.map((progress) => ({ ...progress, blocks: progress.blocks.map((block) => ({ ...block, status: "completed" as const })) })),
      responseSegments: entry.responseSegments?.map((segment) => ({ ...segment, status: "completed" as const })),
      plan: entry.plan ? { ...entry.plan, status: "completed" } : entry.plan,
      activeResponseSegmentId: null,
    };
    if (entry.type === "shell" && entry.status === "running") return { ...entry, status: "failed", summary: "Interrupted before the session closed" };
    return entry;
  });
}

/** Untagged shell/system events belong to their position in the transcript. */
export function eventsBeforeTurn(events: readonly TimelineEvent[], turnId: number): TimelineEvent[] {
  const boundary = events.findIndex((entry) => "turnId" in entry && entry.turnId >= turnId);
  return boundary < 0 ? [...events] : events.slice(0, boundary);
}
