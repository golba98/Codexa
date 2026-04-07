/**
 * Event dispatcher — central hub for UIEvent distribution.
 * Receives events from orchestration stages and updates panel state.
 * Supports subscriptions for React component updates.
 */

import type { UIEvent } from "./events.js";
import { createInitialPanelState, reducePanelState, type PanelState } from "./panelState.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PanelStateListener = (state: PanelState, event: UIEvent) => void;
export type EventInterceptor = (event: UIEvent) => UIEvent | null;
export type UnsubscribeFn = () => void;

export interface EventDispatcherOptions {
  /** Initial state override (for testing or state restoration) */
  initialState?: PanelState;
  /** Debounce high-frequency events by this many milliseconds */
  debounceMs?: number;
  /** Maximum events to buffer before forcing a flush */
  maxBufferSize?: number;
}

// ─── Event Dispatcher Class ───────────────────────────────────────────────────

export class EventDispatcher {
  private state: PanelState;
  private listeners: Set<PanelStateListener> = new Set();
  private interceptors: EventInterceptor[] = [];
  private eventBuffer: UIEvent[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private readonly maxBufferSize: number;

  constructor(options: EventDispatcherOptions = {}) {
    this.state = options.initialState ?? createInitialPanelState();
    this.debounceMs = options.debounceMs ?? 16; // ~60fps
    this.maxBufferSize = options.maxBufferSize ?? 20;
  }

  // ─── State Access ───────────────────────────────────────────────────────────

  getState(): PanelState {
    return this.state;
  }

  // ─── Event Dispatch ─────────────────────────────────────────────────────────

  /**
   * Dispatch a single UIEvent.
   * Events are batched and debounced for performance.
   */
  dispatch(event: UIEvent): void {
    // Run through interceptors
    let processedEvent: UIEvent | null = event;
    for (const interceptor of this.interceptors) {
      processedEvent = interceptor(processedEvent);
      if (processedEvent === null) return;
    }

    this.eventBuffer.push(processedEvent);

    // Force flush if buffer is full
    if (this.eventBuffer.length >= this.maxBufferSize) {
      this.flush();
      return;
    }

    // Schedule debounced flush
    if (this.debounceTimer === null) {
      this.debounceTimer = setTimeout(() => this.flush(), this.debounceMs);
    }
  }

  /**
   * Dispatch multiple events at once.
   */
  dispatchBatch(events: UIEvent[]): void {
    for (const event of events) {
      this.dispatch(event);
    }
  }

  /**
   * Force immediate processing of all buffered events.
   */
  flush(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.eventBuffer.length === 0) return;

    const events = this.eventBuffer.splice(0, this.eventBuffer.length);
    let newState = this.state;

    for (const event of events) {
      newState = reducePanelState(newState, event);
      this.state = newState;

      // Notify listeners after each event (for fine-grained updates)
      for (const listener of this.listeners) {
        try {
          listener(newState, event);
        } catch (error) {
          console.error("EventDispatcher listener error:", error);
        }
      }
    }
  }

  // ─── Subscriptions ──────────────────────────────────────────────────────────

  /**
   * Subscribe to state changes.
   * Listener receives the new state and the event that caused the change.
   */
  subscribe(listener: PanelStateListener): UnsubscribeFn {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Get listener count (useful for debugging).
   */
  getListenerCount(): number {
    return this.listeners.size;
  }

  // ─── Interceptors ───────────────────────────────────────────────────────────

  /**
   * Add an event interceptor.
   * Interceptors can transform events or return null to cancel them.
   * They run in order of registration.
   */
  addInterceptor(interceptor: EventInterceptor): UnsubscribeFn {
    this.interceptors.push(interceptor);
    return () => {
      const index = this.interceptors.indexOf(interceptor);
      if (index >= 0) {
        this.interceptors.splice(index, 1);
      }
    };
  }

  // ─── Reset ──────────────────────────────────────────────────────────────────

  /**
   * Reset state to initial values.
   * Clears all buffered events and notifies listeners.
   */
  reset(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.eventBuffer = [];
    this.state = createInitialPanelState();

    const resetEvent: UIEvent = { type: "run:canceled" };
    for (const listener of this.listeners) {
      try {
        listener(this.state, resetEvent);
      } catch (error) {
        console.error("EventDispatcher listener error during reset:", error);
      }
    }
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.eventBuffer = [];
    this.listeners.clear();
    this.interceptors = [];
  }
}

// ─── Singleton Instance ───────────────────────────────────────────────────────

let globalDispatcher: EventDispatcher | null = null;

export function getGlobalDispatcher(): EventDispatcher {
  if (globalDispatcher === null) {
    globalDispatcher = new EventDispatcher();
  }
  return globalDispatcher;
}

export function setGlobalDispatcher(dispatcher: EventDispatcher): void {
  globalDispatcher?.destroy();
  globalDispatcher = dispatcher;
}

export function resetGlobalDispatcher(): void {
  globalDispatcher?.destroy();
  globalDispatcher = null;
}

// ─── Utility Functions ────────────────────────────────────────────────────────

/**
 * Create a dispatcher scoped to a single run.
 * Useful for isolating state during concurrent operations.
 */
export function createRunDispatcher(options?: EventDispatcherOptions): EventDispatcher {
  return new EventDispatcher(options);
}

/**
 * Create an interceptor that filters events by type.
 */
export function createTypeFilterInterceptor(
  allowedTypes: UIEvent["type"][],
): EventInterceptor {
  const typeSet = new Set(allowedTypes);
  return (event) => (typeSet.has(event.type) ? event : null);
}

/**
 * Create an interceptor that logs events (for debugging).
 */
export function createLoggingInterceptor(prefix = "[UIEvent]"): EventInterceptor {
  return (event) => {
    console.log(`${prefix} ${event.type}`, event);
    return event;
  };
}

/**
 * Create an interceptor that throttles high-frequency events.
 */
export function createThrottleInterceptor(
  eventTypes: UIEvent["type"][],
  intervalMs: number,
): EventInterceptor {
  const typeSet = new Set(eventTypes);
  const lastEmitted = new Map<UIEvent["type"], number>();

  return (event) => {
    if (!typeSet.has(event.type)) return event;

    const now = Date.now();
    const lastTime = lastEmitted.get(event.type) ?? 0;

    if (now - lastTime < intervalMs) {
      return null; // Throttle this event
    }

    lastEmitted.set(event.type, now);
    return event;
  };
}
