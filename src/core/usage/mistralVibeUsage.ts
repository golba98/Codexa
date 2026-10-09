import type { UsageAdapter } from "./types.js";

/**
 * Mistral Vibe (verified against vibe 2.26.0) exposes no usage, budget, quota or
 * rate-limit interface: its CLI and app-server only read plan metadata through a
 * session-scoped `/api/vibe/whoami` call, and `vibe -p` would forward a slash
 * command to the model. Ubume therefore reports the limitation instead of
 * starting a Vibe session or a model request.
 */
export const mistralVibeUsageAdapter: UsageAdapter = {
  id: "mistral-vibe",
  passive: true,
  fetch: async (context) => ({
    providerId: "mistral",
    providerLabel: "Mistral Vibe",
    scopeKey: context.scopeKey,
    billingMode: "unknown",
    status: "unsupported",
    retrievedAt: context.now(),
    freshness: "live",
    source: "Mistral Vibe CLI (no usage interface)",
    limits: [],
    facts: [
      { id: "mistral.vibe_budget", label: "Vibe subscription budget", value: "Unavailable" },
      { id: "mistral.api_limits", label: "API rate limits", value: "Unavailable" },
    ],
    message:
      "Mistral Vibe does not expose subscription usage, monthly budgets or API rate limits to other programs. Limits still apply; check them in the Mistral console.",
    links: [{ label: "Console", url: "https://console.mistral.ai" }],
  }),
};
