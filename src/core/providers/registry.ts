import { DEFAULT_BACKEND } from "../../config/settings.js";
import { codexSubprocessProvider } from "./codexSubprocess.js";
import { openaiNativeProvider } from "./openaiNative.js";
import type { BackendProvider } from "./types.js";

const BACKEND_PROVIDERS: BackendProvider[] = [codexSubprocessProvider, openaiNativeProvider];

export function getBackendProvider(id: string): BackendProvider {
  return (
    BACKEND_PROVIDERS.find((provider) => provider.id === id) ??
    BACKEND_PROVIDERS.find((provider) => provider.id === DEFAULT_BACKEND) ??
    codexSubprocessProvider
  );
}
