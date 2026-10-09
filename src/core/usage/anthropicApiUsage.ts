import { deriveLimitState, parseResetTime, percentOfTotal } from "./normalize.js";
import { ANTHROPIC_RATE_LIMIT_KINDS, getObservedRateLimits } from "./observedRateLimits.js";
import type {
  ProviderUsageSnapshot,
  UsageAdapter,
  UsageLimit,
  UsageRequestContext,
} from "./types.js";

const LABELS: Record<
  (typeof ANTHROPIC_RATE_LIMIT_KINDS)[number],
  { label: string; unit: UsageLimit["unit"] }
> = {
  requests: { label: "Requests per minute", unit: "requests" },
  tokens: { label: "Tokens per minute", unit: "tokens" },
  "input-tokens": { label: "Input tokens per minute", unit: "tokens" },
  "output-tokens": { label: "Output tokens per minute", unit: "tokens" },
};

const BILLING_LINK = { label: "Billing", url: "https://platform.claude.com/settings/billing" };

/** Usage for the direct Anthropic API route, built only from observed response headers. */
export function buildAnthropicApiUsageSnapshot(
  context: UsageRequestContext,
): ProviderUsageSnapshot {
  const base: ProviderUsageSnapshot = {
    providerId: "anthropic",
    providerLabel: "Anthropic API",
    scopeKey: context.scopeKey,
    account: { authMethod: "API key" },
    billingMode: "api",
    status: "unsupported",
    freshness: "observed",
    source: "anthropic-ratelimit-* response headers",
    limits: [],
    facts: [],
    links: [BILLING_LINK],
  };
  const observed = getObservedRateLimits(context.scopeKey);
  if (!observed) {
    return {
      ...base,
      message:
        "Anthropic API keys cannot query usage or billing. Rate limits appear after the next response from this route; spend is shown in the Claude Console.",
    };
  }
  const limits: UsageLimit[] = [];
  for (const kind of ANTHROPIC_RATE_LIMIT_KINDS) {
    const window = observed.windows[kind];
    if (!window) continue;
    const remainingPercent = percentOfTotal(window.remaining, window.limit);
    const limit: UsageLimit = {
      id: `anthropic-api.${kind}`,
      label: LABELS[kind].label,
      unit: LABELS[kind].unit,
      total: window.limit,
      remaining: window.remaining,
      used:
        window.limit !== undefined &&
        window.remaining !== undefined &&
        window.remaining <= window.limit
          ? window.limit - window.remaining
          : undefined,
      remainingPercent,
      usedPercent: remainingPercent === undefined ? undefined : 100 - remainingPercent,
      resetsAt: parseResetTime(window.reset, observed.observedAt),
    };
    limit.state = deriveLimitState(limit);
    limits.push(limit);
  }
  return {
    ...base,
    status: "partial",
    retrievedAt: observed.observedAt,
    limits,
    message:
      "Observed from the last API response — not a live query. API keys cannot read spend; see the Claude Console.",
  };
}

export const anthropicApiUsageAdapter: UsageAdapter = {
  id: "anthropic-api",
  passive: true,
  fetch: async (context) => buildAnthropicApiUsageSnapshot(context),
};
