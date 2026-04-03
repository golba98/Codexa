import { AVAILABLE_MODELS } from "../../config/settings.js";
import type { BackendProvider } from "./types.js";

export const openaiNativeProvider: BackendProvider = {
  id: "openai-native",
  label: "OpenAI Native",
  description: "Planned native backend. Requires official API credentials when implemented.",
  authState: "coming-soon",
  authLabel: "Not implemented yet",
  statusMessage:
    "ChatGPT subscriptions and API billing are separate. Native execution is intentionally disabled in v1.",
  supportsModels: (model) => (AVAILABLE_MODELS as readonly string[]).includes(model),
};
