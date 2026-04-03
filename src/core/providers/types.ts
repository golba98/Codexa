import type { AvailableBackend, AvailableMode, AvailableModel, ReasoningLevel } from "../../config/settings.js";
import type { RunToolActivity } from "../../session/types.js";

export type BackendAuthState = "delegated" | "api-key-required" | "coming-soon";

export interface BackendRunHandlers {
  onResponse: (response: string) => void;
  onError: (message: string, rawOutput?: string) => void;
  /** Called with each new thinking/progress line while the process is still running. */
  onProgress?: (line: string) => void;
  /** Called with each new assistant content delta while the process is still running. */
  onAssistantDelta?: (chunk: string) => void;
  /** Called when the backend starts or finishes a tool/shell action during a run. */
  onToolActivity?: (activity: RunToolActivity) => void;
}

export interface BackendProvider {
  id: AvailableBackend;
  label: string;
  description: string;
  authState: BackendAuthState;
  authLabel: string;
  statusMessage: string;
  supportsModels: (model: string) => boolean;
  run?: (
    prompt: string,
    options: {
      model: AvailableModel;
      mode: AvailableMode;
      reasoningLevel: ReasoningLevel;
      workspaceRoot: string;
    },
    handlers: BackendRunHandlers,
  ) => () => void;
}
