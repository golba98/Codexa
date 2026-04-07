/**
 * Panel state model — structured application state backing all UI panels.
 * Each panel has independent state that updates based on UIEvents.
 */

import type {
  FileInspectionStatus,
  ResultSectionType,
  RunPhase,
  TaskType,
  ToolActivityStatus,
  UIEvent,
} from "./events.js";

// Re-export types needed by consumers
export type { TaskType, RunPhase };

// ─── Panel Data Types ─────────────────────────────────────────────────────────

export interface FileInspection {
  path: string;
  status: FileInspectionStatus;
  relevance?: number;
  reason?: string;
  addedAt: number;
}

export interface ToolActivity {
  id: string;
  name: string;
  command?: string;
  status: ToolActivityStatus;
  message?: string;
  progress?: number;
  startedAt: number;
  completedAt?: number;
  summary?: string;
}

export interface DiffEntry {
  file: string;
  patch: string;
  language?: string;
  status: "streaming" | "complete";
}

export interface CommandEntry {
  content: string;
  description?: string;
  copyable: boolean;
  addedAt: number;
}

export interface ResultSection {
  type: ResultSectionType;
  content: string;
  addedAt: number;
}

// ─── Panel State Shape ────────────────────────────────────────────────────────

export interface PanelState {
  // Run metadata
  taskType: TaskType | null;
  runPhase: RunPhase;
  startedAt: number | null;

  // Status panel
  status: string;

  // Thinking panel
  thinkingActive: boolean;
  thinkingTitle: string;
  thinkingSummaries: string[];

  // Files panel
  filesActive: boolean;
  filesTitle: string;
  files: FileInspection[];
  filesComplete: boolean;
  filesTotalCount: number;

  // Tools panel
  tools: ToolActivity[];

  // Result panel
  sections: ResultSection[];
  partialContent: string;
  finalContent: string;

  // Diff panel
  diffs: DiffEntry[];

  // Commands panel
  commands: CommandEntry[];

  // Warnings/errors
  warnings: string[];
  error: string | null;

  // Completion metadata
  durationMs: number | null;
  filesModified: number;
}

// ─── Initial State ────────────────────────────────────────────────────────────

export function createInitialPanelState(): PanelState {
  return {
    taskType: null,
    runPhase: "idle",
    startedAt: null,
    status: "",
    thinkingActive: false,
    thinkingTitle: "",
    thinkingSummaries: [],
    filesActive: false,
    filesTitle: "",
    files: [],
    filesComplete: false,
    filesTotalCount: 0,
    tools: [],
    sections: [],
    partialContent: "",
    finalContent: "",
    diffs: [],
    commands: [],
    warnings: [],
    error: null,
    durationMs: null,
    filesModified: 0,
  };
}

// ─── Configuration ────────────────────────────────────────────────────────────

const MAX_THINKING_SUMMARIES = 8;
const MAX_FILES_TRACKED = 50;
const MAX_WARNINGS = 10;

// ─── Panel State Reducer ──────────────────────────────────────────────────────

export function reducePanelState(state: PanelState, event: UIEvent): PanelState {
  switch (event.type) {
    // ─── Run Lifecycle ──────────────────────────────────────────────────────
    case "run:start":
      return {
        ...createInitialPanelState(),
        taskType: event.taskType,
        runPhase: "classifying",
        startedAt: event.timestamp,
        status: event.message,
      };

    case "run:phase":
      return { ...state, runPhase: event.phase };

    case "run:complete":
      return {
        ...state,
        runPhase: "complete",
        durationMs: event.durationMs,
        filesModified: event.filesModified,
        thinkingActive: false,
        filesActive: false,
      };

    case "run:failed":
      return {
        ...state,
        runPhase: "failed",
        error: event.error,
        thinkingActive: false,
        filesActive: false,
      };

    case "run:canceled":
      return {
        ...state,
        runPhase: "canceled",
        thinkingActive: false,
        filesActive: false,
      };

    // ─── Status Panel ───────────────────────────────────────────────────────
    case "status":
      return { ...state, status: event.message };

    case "status:clear":
      return { ...state, status: "" };

    // ─── Thinking Panel ─────────────────────────────────────────────────────
    case "thinking:start":
      return {
        ...state,
        thinkingActive: true,
        thinkingTitle: event.title ?? "Processing...",
        thinkingSummaries: [],
      };

    case "thinking:update": {
      const summaries = [...state.thinkingSummaries, event.summary];
      return {
        ...state,
        thinkingSummaries: summaries.slice(-MAX_THINKING_SUMMARIES),
      };
    }

    case "thinking:done":
      return { ...state, thinkingActive: false };

    // ─── Files Panel ────────────────────────────────────────────────────────
    case "files:start":
      return {
        ...state,
        filesActive: true,
        filesTitle: event.title ?? "Inspecting files...",
        files: [],
        filesComplete: false,
        filesTotalCount: event.estimatedCount ?? 0,
      };

    case "files:item": {
      const existingIndex = state.files.findIndex((f) => f.path === event.path);
      let updatedFiles: FileInspection[];

      if (existingIndex >= 0) {
        updatedFiles = [...state.files];
        updatedFiles[existingIndex] = {
          ...updatedFiles[existingIndex],
          status: event.status,
          relevance: event.relevance ?? updatedFiles[existingIndex]!.relevance,
          reason: event.reason ?? updatedFiles[existingIndex]!.reason,
        };
      } else {
        const newFile: FileInspection = {
          path: event.path,
          status: event.status,
          relevance: event.relevance,
          reason: event.reason,
          addedAt: Date.now(),
        };
        updatedFiles = [...state.files, newFile].slice(-MAX_FILES_TRACKED);
      }

      return { ...state, files: updatedFiles };
    }

    case "files:done":
      return {
        ...state,
        filesActive: false,
        filesComplete: true,
        filesTotalCount: event.totalCount,
      };

    // ─── Tools Panel ────────────────────────────────────────────────────────
    case "tool:start": {
      const newTool: ToolActivity = {
        id: event.id,
        name: event.name,
        command: event.command,
        status: "running",
        startedAt: Date.now(),
      };
      return { ...state, tools: [...state.tools, newTool] };
    }

    case "tool:update": {
      const toolIndex = state.tools.findIndex((t) => t.id === event.id);
      if (toolIndex < 0) return state;

      const updatedTools = [...state.tools];
      updatedTools[toolIndex] = {
        ...updatedTools[toolIndex]!,
        message: event.message,
        progress: event.progress,
      };
      return { ...state, tools: updatedTools };
    }

    case "tool:done": {
      const toolIndex = state.tools.findIndex((t) => t.id === event.id);
      if (toolIndex < 0) return state;

      const updatedTools = [...state.tools];
      updatedTools[toolIndex] = {
        ...updatedTools[toolIndex]!,
        status: event.status,
        summary: event.summary,
        completedAt: Date.now(),
      };
      return { ...state, tools: updatedTools };
    }

    // ─── Result Panel ───────────────────────────────────────────────────────
    case "assistant:section": {
      const newSection: ResultSection = {
        type: event.section,
        content: event.content,
        addedAt: Date.now(),
      };
      return { ...state, sections: [...state.sections, newSection] };
    }

    case "assistant:partial":
      return { ...state, partialContent: state.partialContent + event.content };

    case "assistant:final":
      return {
        ...state,
        finalContent: event.content,
        partialContent: "",
      };

    case "assistant:clear":
      return {
        ...state,
        sections: [],
        partialContent: "",
        finalContent: "",
      };

    // ─── Diff Panel ─────────────────────────────────────────────────────────
    case "diff:start": {
      const existingDiffIndex = state.diffs.findIndex((d) => d.file === event.file);
      if (existingDiffIndex >= 0) {
        const updatedDiffs = [...state.diffs];
        updatedDiffs[existingDiffIndex] = {
          ...updatedDiffs[existingDiffIndex]!,
          status: "streaming",
          patch: "",
        };
        return { ...state, diffs: updatedDiffs };
      }

      const newDiff: DiffEntry = {
        file: event.file,
        patch: "",
        status: "streaming",
      };
      return { ...state, diffs: [...state.diffs, newDiff] };
    }

    case "diff:content": {
      const diffIndex = state.diffs.findIndex((d) => d.file === event.file);
      if (diffIndex >= 0) {
        const updatedDiffs = [...state.diffs];
        updatedDiffs[diffIndex] = {
          ...updatedDiffs[diffIndex]!,
          patch: updatedDiffs[diffIndex]!.patch + event.patch,
          language: event.language,
        };
        return { ...state, diffs: updatedDiffs };
      }

      const newDiff: DiffEntry = {
        file: event.file,
        patch: event.patch,
        language: event.language,
        status: "streaming",
      };
      return { ...state, diffs: [...state.diffs, newDiff] };
    }

    case "diff:done": {
      const diffIndex = state.diffs.findIndex((d) => d.file === event.file);
      if (diffIndex < 0) return state;

      const updatedDiffs = [...state.diffs];
      updatedDiffs[diffIndex] = {
        ...updatedDiffs[diffIndex]!,
        status: "complete",
      };
      return { ...state, diffs: updatedDiffs };
    }

    // ─── Commands Panel ─────────────────────────────────────────────────────
    case "command": {
      const newCommand: CommandEntry = {
        content: event.content,
        description: event.description,
        copyable: event.copyable ?? true,
        addedAt: Date.now(),
      };
      return { ...state, commands: [...state.commands, newCommand] };
    }

    // ─── Warnings & Errors ──────────────────────────────────────────────────
    case "warning":
      return {
        ...state,
        warnings: [...state.warnings, event.message].slice(-MAX_WARNINGS),
      };

    case "error":
      return { ...state, error: event.message };

    default:
      return state;
  }
}

// ─── State Selectors ──────────────────────────────────────────────────────────

export function isRunActive(state: PanelState): boolean {
  return (
    state.runPhase !== "idle" &&
    state.runPhase !== "complete" &&
    state.runPhase !== "failed" &&
    state.runPhase !== "canceled"
  );
}

export function isRunComplete(state: PanelState): boolean {
  return state.runPhase === "complete";
}

export function isRunFailed(state: PanelState): boolean {
  return state.runPhase === "failed";
}

export function hasVisibleThinking(state: PanelState): boolean {
  return state.thinkingActive || state.thinkingSummaries.length > 0;
}

export function hasVisibleFiles(state: PanelState): boolean {
  return state.filesActive || state.files.length > 0;
}

export function hasVisibleTools(state: PanelState): boolean {
  return state.tools.length > 0;
}

export function hasVisibleResult(state: PanelState): boolean {
  return (
    state.sections.length > 0 ||
    state.partialContent.length > 0 ||
    state.finalContent.length > 0
  );
}

export function hasVisibleDiffs(state: PanelState): boolean {
  return state.diffs.length > 0;
}

export function hasVisibleCommands(state: PanelState): boolean {
  return state.commands.length > 0;
}

export function getActiveToolCount(state: PanelState): number {
  return state.tools.filter((t) => t.status === "running").length;
}

export function getAnalyzedFileCount(state: PanelState): number {
  return state.files.filter((f) => f.status === "analyzed" || f.status === "done").length;
}

export function getResultContent(state: PanelState): string {
  if (state.finalContent) return state.finalContent;
  if (state.partialContent) return state.partialContent;
  return state.sections.map((s) => s.content).join("\n\n");
}
