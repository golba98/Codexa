/**
 * useOrchestrator — React hook for managing staged runs with the orchestration pipeline.
 * Integrates RunOrchestrator with React state and session management.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { AvailableBackend, AvailableMode, AvailableModel, ReasoningLevel } from "../config/settings.js";
import type { PanelState } from "../orchestration/panelState.js";
import {
  RunOrchestrator,
  createInitialPanelState,
  type OrchestratorOptions,
  type UIEvent,
  type BackendRunner,
} from "../orchestration/index.js";

export interface UseOrchestratorOptions {
  workspaceRoot: string;
  backend: AvailableBackend;
  model: AvailableModel;
  mode: AvailableMode;
  reasoningLevel: ReasoningLevel;
  /** Backend runner function (e.g., from provider.run) */
  backendRunner: BackendRunner;
  /** Called when the run completes successfully */
  onComplete?: (state: PanelState, response: string) => void;
  /** Called when the run fails */
  onError?: (state: PanelState, error: string) => void;
  /** Called when the run is canceled */
  onCancel?: (state: PanelState) => void;
  /** Called for each UI event (for logging/debugging) */
  onEvent?: (event: UIEvent) => void;
}

export interface OrchestratorHandle {
  /** Start a new staged run */
  start: (prompt: string) => void;
  /** Cancel the current run */
  cancel: () => void;
  /** Check if a run is currently active */
  isActive: () => boolean;
  /** Get the current panel state */
  getState: () => PanelState;
}

export interface UseOrchestratorResult {
  /** Current panel state */
  panelState: PanelState;
  /** Whether a run is currently active */
  isActive: boolean;
  /** Handle for controlling the orchestrator */
  handle: OrchestratorHandle;
}

export function useOrchestrator(options: UseOrchestratorOptions): UseOrchestratorResult {
  const {
    workspaceRoot,
    backend,
    model,
    mode,
    reasoningLevel,
    backendRunner,
    onComplete,
    onError,
    onCancel,
    onEvent,
  } = options;

  // State
  const [panelState, setPanelState] = useState<PanelState>(createInitialPanelState);
  const [isActive, setIsActive] = useState(false);

  // Refs for callbacks and orchestrator instance
  const orchestratorRef = useRef<RunOrchestrator | null>(null);
  const callbacksRef = useRef({ onComplete, onError, onCancel, onEvent, backendRunner });
  callbacksRef.current = { onComplete, onError, onCancel, onEvent, backendRunner };

  // Create orchestrator options
  const orchestratorOptions = useMemo((): OrchestratorOptions => ({
    workspaceRoot,
    model,
    mode,
    reasoningLevel,
    onEvent: (event) => callbacksRef.current.onEvent?.(event),
    onStateChange: (state) => setPanelState(state),
  }), [workspaceRoot, model, mode, reasoningLevel]);

  // Start a new run
  const start = useCallback((prompt: string) => {
    // Cancel any existing run
    if (orchestratorRef.current) {
      orchestratorRef.current.cancel();
    }

    // Create new orchestrator instance
    const orchestrator = new RunOrchestrator(orchestratorOptions);
    orchestratorRef.current = orchestrator;
    setIsActive(true);

    // Start the run
    orchestrator.startRun(prompt, callbacksRef.current.backendRunner)
      .then(() => {
        const finalState = orchestrator.getState();
        const response = finalState.finalContent || finalState.partialContent;

        setIsActive(false);
        orchestratorRef.current = null;

        if (finalState.runPhase === "complete") {
          callbacksRef.current.onComplete?.(finalState, response);
        }
      })
      .catch((error) => {
        const finalState = orchestrator.getState();
        const errorMessage = error instanceof Error ? error.message : "Run failed";

        setIsActive(false);
        orchestratorRef.current = null;

        if (finalState.runPhase === "failed") {
          callbacksRef.current.onError?.(finalState, finalState.error ?? errorMessage);
        } else if (finalState.runPhase === "canceled") {
          callbacksRef.current.onCancel?.(finalState);
        } else {
          callbacksRef.current.onError?.(finalState, errorMessage);
        }
      });
  }, [orchestratorOptions]);

  // Cancel the current run
  const cancel = useCallback(() => {
    if (orchestratorRef.current) {
      orchestratorRef.current.cancel();
      // State updates will happen via callbacks
    }
  }, []);

  // Check if run is active
  const checkIsActive = useCallback(() => {
    return isActive;
  }, [isActive]);

  // Get current state
  const getState = useCallback(() => {
    return orchestratorRef.current?.getState() ?? panelState;
  }, [panelState]);

  // Create handle
  const handle = useMemo((): OrchestratorHandle => ({
    start,
    cancel,
    isActive: checkIsActive,
    getState,
  }), [start, cancel, checkIsActive, getState]);

  return {
    panelState,
    isActive,
    handle,
  };
}

// ─── Simplified Hook for One-Off Runs ─────────────────────────────────────────

export interface UseStagedRunResult {
  panelState: PanelState;
  isActive: boolean;
  startRun: (prompt: string) => void;
  cancelRun: () => void;
  response: string | null;
  error: string | null;
}

/**
 * Simplified hook for running a single staged task.
 * Manages completion state internally.
 */
export function useStagedRun(
  options: Omit<UseOrchestratorOptions, "onComplete" | "onError" | "onCancel">,
): UseStagedRunResult {
  const [response, setResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { panelState, isActive, handle } = useOrchestrator({
    ...options,
    onComplete: (_state, resp) => {
      setResponse(resp);
      setError(null);
    },
    onError: (_state, err) => {
      setError(err);
      setResponse(null);
    },
    onCancel: () => {
      // Keep existing response/error on cancel
    },
  });

  const startRun = useCallback((prompt: string) => {
    setResponse(null);
    setError(null);
    handle.start(prompt);
  }, [handle]);

  return {
    panelState,
    isActive,
    startRun,
    cancelRun: handle.cancel,
    response,
    error,
  };
}
