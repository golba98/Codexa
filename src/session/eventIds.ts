import { LEGACY_GOOGLE_MESSAGE } from "../core/providerLauncher/providerIdentity.js";
import type { ProviderId, ProviderWorkspaceConfig } from "../core/providerLauncher/types.js";
import { formatRuntimeProviderLabel } from "../core/providerRuntime/registry.js";

import { sanitizeTerminalOutput } from "../core/terminal/terminalSanitize.js";

import type { TimelineEvent } from "./types.js";

// ─── Module Constants & Helpers ────────────────────────────────────────────────

let nextEventId = 0;

let nextTurnId = 0;

export function createEventId(): number {
  return nextEventId++;
}

export function createTurnId(): number {
  return nextTurnId++;
}

export function createProviderMigrationNoticeEvent(
  notice: ProviderWorkspaceConfig["migrationNotice"] | undefined,
  providerLabel: string | null = null,
): TimelineEvent | null {
  if (!notice) return null;

  const resolvedProviderLabel =
    providerLabel ?? formatRuntimeProviderLabel(notice.revertedProviderId);
  return {
    id: createEventId(),
    type: "system",
    createdAt: Date.now(),
    title: sanitizeTerminalOutput("Provider migrated"),
    content: sanitizeTerminalOutput(
      `${formatRuntimeProviderLabel(notice.deprecatedProviderId as ProviderId)} provider is no longer supported. Reverted to ${resolvedProviderLabel}.`,
      { preserveTabs: false, tabSize: 2 },
    ),
  };
}

export function createStartupStaticEvents({
  providerWorkspaceConfig,
}: {
  providerWorkspaceConfig: ProviderWorkspaceConfig;
}): TimelineEvent[] {
  if (providerWorkspaceConfig.googleMigrationRequired)
    return [
      {
        id: createEventId(),
        type: "system",
        createdAt: Date.now(),
        title: "Google migration required",
        content: LEGACY_GOOGLE_MESSAGE,
      },
    ];
  return [createProviderMigrationNoticeEvent(providerWorkspaceConfig.migrationNotice)].filter(
    (event): event is TimelineEvent => event !== null,
  );
}

export function advanceIdsPast(events: readonly TimelineEvent[]): void {
  for (const event of events) {
    nextEventId = Math.max(nextEventId, event.id + 1);
    if ("turnId" in event) nextTurnId = Math.max(nextTurnId, event.turnId + 1);
  }
}

import type { CodexAuthProbeResult } from "../core/codex/codexAuth.js";

export function createInitialAuthStatus(): CodexAuthProbeResult {
  return {
    state: "checking",
    checkedAt: 0,
    rawSummary: "Auth check pending.",
    recommendedAction: "Run /auth status to check sign-in state.",
  };
}

export interface PromptRunTiming {
  submitEpochMs: number;
  submitMonotonicMs: number;
}

export function createPromptRunTiming(): PromptRunTiming {
  return {
    submitEpochMs: Date.now(),
    submitMonotonicMs: performance.now(),
  };
}
