import type { ProviderWorkspaceOverride } from "../providerLauncher/types.js";
import { resolveAnthropicExecutionBackend } from "../providerRuntime/anthropic.js";
import type { ProviderRoute } from "../providerRuntime/types.js";
import { anthropicApiUsageAdapter } from "./anthropicApiUsage.js";
import { antigravityUsageAdapter } from "./antigravityUsage.js";
import { claudeCodeUsageAdapter } from "./claudeCodeUsage.js";
import { codexUsageAdapter } from "./codexUsage.js";
import { localUsageAdapter } from "./localUsage.js";
import { mistralVibeUsageAdapter } from "./mistralVibeUsage.js";
import { buildUsageScopeKey } from "./normalize.js";
import type { UsageAdapter } from "./types.js";

export const unsupportedUsageAdapter: UsageAdapter = {
  id: "unsupported",
  passive: true,
  fetch: async (context) => ({
    providerId: context.route.providerId,
    providerLabel: context.route.providerId,
    scopeKey: context.scopeKey,
    billingMode: "unknown",
    status: "unsupported",
    retrievedAt: context.now(),
    freshness: "live",
    source: "none",
    limits: [],
    facts: [],
    message: "This provider does not expose a supported usage interface to Ubume.",
  }),
};

export interface UsageTarget {
  adapter: UsageAdapter;
  /** The route as it will actually execute (e.g. Claude Code vs the direct API). */
  route: ProviderRoute;
  scopeKey: string;
}

/**
 * Maps the active route to the adapter that reads usage for the account that
 * route really uses. Adding a provider means adding a case here only.
 */
export function resolveUsageTarget(
  route: ProviderRoute,
  providerConfig?: ProviderWorkspaceOverride,
): UsageTarget {
  let effective = route;
  let adapter: UsageAdapter;
  switch (route.providerId) {
    case "openai":
      adapter = codexUsageAdapter;
      break;
    case "anthropic": {
      const backendKind = resolveAnthropicExecutionBackend(route, providerConfig);
      effective = { ...route, backendKind };
      adapter =
        backendKind === "anthropic-api-key" ? anthropicApiUsageAdapter : claudeCodeUsageAdapter;
      break;
    }
    case "google":
      adapter = antigravityUsageAdapter;
      break;
    case "mistral":
      adapter = mistralVibeUsageAdapter;
      break;
    case "local":
    case "codexa-native":
    case "codexa-cupy":
      adapter = localUsageAdapter;
      break;
    default:
      adapter = unsupportedUsageAdapter;
  }
  return { adapter, route: effective, scopeKey: buildUsageScopeKey(effective, providerConfig) };
}
