/**
 * Orchestration module — staged rendering pipeline infrastructure.
 *
 * This module provides the core event-driven architecture for rendering
 * AI responses progressively through distinct UI panels.
 */

// ─── Events ───────────────────────────────────────────────────────────────────

export {
  // Types
  type TaskType,
  type FileInspectionStatus,
  type ToolActivityStatus,
  type RunPhase,
  type ResultSectionType,
  type UIEvent,
  // Type guards
  isRunLifecycleEvent,
  isStatusEvent,
  isThinkingEvent,
  isFilesEvent,
  isToolEvent,
  isAssistantEvent,
  isDiffEvent,
  // Utilities
  createTimestamp,
  // Event factories
  createRunStartEvent,
  createStatusEvent,
  createThinkingUpdateEvent,
  createFileItemEvent,
  createToolStartEvent,
  createToolDoneEvent,
  createAssistantPartialEvent,
  createAssistantFinalEvent,
  createDiffEvent,
  createCommandEvent,
  createWarningEvent,
  createErrorEvent,
  createRunCompleteEvent,
  createRunFailedEvent,
  createRunCanceledEvent,
} from "./events.js";

// ─── Panel State ──────────────────────────────────────────────────────────────

export {
  // Types
  type FileInspection,
  type ToolActivity,
  type DiffEntry,
  type CommandEntry,
  type ResultSection,
  type PanelState,
  // State management
  createInitialPanelState,
  reducePanelState,
  // Selectors
  isRunActive,
  isRunComplete,
  isRunFailed,
  hasVisibleThinking,
  hasVisibleFiles,
  hasVisibleTools,
  hasVisibleResult,
  hasVisibleDiffs,
  hasVisibleCommands,
  getActiveToolCount,
  getAnalyzedFileCount,
  getResultContent,
} from "./panelState.js";

// ─── Event Dispatcher ─────────────────────────────────────────────────────────

export {
  // Types
  type PanelStateListener,
  type EventInterceptor,
  type UnsubscribeFn,
  type EventDispatcherOptions,
  // Class
  EventDispatcher,
  // Global instance
  getGlobalDispatcher,
  setGlobalDispatcher,
  resetGlobalDispatcher,
  // Factory functions
  createRunDispatcher,
  createTypeFilterInterceptor,
  createLoggingInterceptor,
  createThrottleInterceptor,
} from "./eventDispatcher.js";

// ─── Task Classification ──────────────────────────────────────────────────────

export {
  classifyTask,
  getTaskTypeLabel,
  getTaskStartMessage,
  getTaskFlowConfig,
  extractKeywords,
  extractFileMentions,
  type TaskFlowConfig,
} from "./taskClassifier.js";

// ─── Preflight Scanner ────────────────────────────────────────────────────────

export {
  runPreflightScan,
  quickScanFiles,
  getRelevantFilePaths,
  scanWorkspaceFiles,
  scoreFileRelevance,
  type PreflightScanOptions,
  type CandidateFile,
  type ScoredFile,
} from "./preflightScanner.js";

// ─── Section Parser ───────────────────────────────────────────────────────────

export {
  createSectionParser,
  createHybridParser,
  parseToolActivity,
  parseDiffBlock,
  parseThinkingContent,
  parseCommandBlocks,
  type SectionParserHandlers,
} from "./sectionParser.js";

// ─── Run Orchestrator ─────────────────────────────────────────────────────────

export {
  RunOrchestrator,
  createOrchestrator,
  startOrchestratedRun,
  type OrchestratorOptions,
  type RunContext,
  type BackendCallbacks,
  type BackendRunner,
} from "./runOrchestrator.js";

// ─── React Integration ────────────────────────────────────────────────────────

export {
  useOrchestrator,
  useStagedRun,
  type UseOrchestratorOptions,
  type UseOrchestratorResult,
  type OrchestratorHandle,
  type UseStagedRunResult,
} from "./useOrchestrator.js";
