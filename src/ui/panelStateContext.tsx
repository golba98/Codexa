/**
 * React context and hooks for panel state management.
 * Provides easy access to orchestration state in UI components.
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  EventDispatcher,
  createRunDispatcher,
  createInitialPanelState,
  type PanelState,
  type UIEvent,
} from "../orchestration/index.js";

// ─── Context ──────────────────────────────────────────────────────────────────

interface PanelStateContextValue {
  state: PanelState;
  dispatcher: EventDispatcher;
  dispatch: (event: UIEvent) => void;
}

const PanelStateContext = createContext<PanelStateContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

interface PanelStateProviderProps {
  children: React.ReactNode;
  /** External dispatcher (for integration with existing state management) */
  dispatcher?: EventDispatcher;
  /** Initial state override */
  initialState?: PanelState;
}

export function PanelStateProvider({
  children,
  dispatcher: externalDispatcher,
  initialState,
}: PanelStateProviderProps) {
  // Create or use provided dispatcher
  const dispatcher = useMemo(() => {
    if (externalDispatcher) return externalDispatcher;
    return createRunDispatcher({ initialState });
  }, [externalDispatcher, initialState]);

  // Track state changes
  const [state, setState] = useState<PanelState>(
    () => dispatcher.getState(),
  );

  useEffect(() => {
    // Subscribe to state changes
    const unsubscribe = dispatcher.subscribe((newState) => {
      setState(newState);
    });

    return () => {
      unsubscribe();
      // Only destroy if we created the dispatcher
      if (!externalDispatcher) {
        dispatcher.destroy();
      }
    };
  }, [dispatcher, externalDispatcher]);

  const value = useMemo<PanelStateContextValue>(() => ({
    state,
    dispatcher,
    dispatch: (event: UIEvent) => dispatcher.dispatch(event),
  }), [state, dispatcher]);

  return (
    <PanelStateContext.Provider value={value}>
      {children}
    </PanelStateContext.Provider>
  );
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Access the full panel state context.
 */
export function usePanelStateContext(): PanelStateContextValue {
  const context = useContext(PanelStateContext);
  if (!context) {
    throw new Error("usePanelStateContext must be used within a PanelStateProvider");
  }
  return context;
}

/**
 * Access just the panel state.
 */
export function usePanelState(): PanelState {
  const { state } = usePanelStateContext();
  return state;
}

/**
 * Access the event dispatcher.
 */
export function usePanelDispatcher(): EventDispatcher {
  const { dispatcher } = usePanelStateContext();
  return dispatcher;
}

/**
 * Dispatch a single UI event.
 */
export function useDispatchEvent(): (event: UIEvent) => void {
  const { dispatch } = usePanelStateContext();
  return dispatch;
}

// ─── Selector Hooks ───────────────────────────────────────────────────────────

/**
 * Select a specific part of panel state.
 */
export function usePanelSelector<T>(selector: (state: PanelState) => T): T {
  const state = usePanelState();
  return selector(state);
}

/**
 * Check if a run is currently active.
 */
export function useIsRunActive(): boolean {
  return usePanelSelector((s) =>
    s.runPhase !== "idle" &&
    s.runPhase !== "complete" &&
    s.runPhase !== "failed" &&
    s.runPhase !== "canceled",
  );
}

/**
 * Get the current run phase.
 */
export function useRunPhase(): PanelState["runPhase"] {
  return usePanelSelector((s) => s.runPhase);
}

/**
 * Get the current status message.
 */
export function useStatusMessage(): string {
  return usePanelSelector((s) => s.status);
}

/**
 * Get thinking summaries.
 */
export function useThinkingSummaries(): string[] {
  return usePanelSelector((s) => s.thinkingSummaries);
}

/**
 * Get file inspections.
 */
export function useFileInspections(): PanelState["files"] {
  return usePanelSelector((s) => s.files);
}

/**
 * Get tool activities.
 */
export function useToolActivities(): PanelState["tools"] {
  return usePanelSelector((s) => s.tools);
}

/**
 * Get result content (final or partial).
 */
export function useResultContent(): string {
  return usePanelSelector((s) => s.finalContent || s.partialContent);
}

/**
 * Get diffs.
 */
export function useDiffs(): PanelState["diffs"] {
  return usePanelSelector((s) => s.diffs);
}

/**
 * Get commands.
 */
export function useCommands(): PanelState["commands"] {
  return usePanelSelector((s) => s.commands);
}

// ─── Standalone Hook (no provider needed) ─────────────────────────────────────

interface UseStagedRunOptions {
  initialState?: PanelState;
}

/**
 * Standalone hook for managing panel state without a provider.
 * Useful for isolated components or testing.
 */
export function useStagedRun(options: UseStagedRunOptions = {}) {
  const dispatcher = useMemo(() => {
    return createRunDispatcher({ initialState: options.initialState });
  }, []);

  const [state, setState] = useState<PanelState>(
    () => options.initialState ?? createInitialPanelState(),
  );

  useEffect(() => {
    const unsubscribe = dispatcher.subscribe((newState) => {
      setState(newState);
    });

    return () => {
      unsubscribe();
      dispatcher.destroy();
    };
  }, [dispatcher]);

  return {
    state,
    dispatcher,
    dispatch: (event: UIEvent) => dispatcher.dispatch(event),
    reset: () => dispatcher.reset(),
  };
}
