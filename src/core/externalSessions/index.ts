import { listAntigravitySessions, readAntigravityTranscript } from "./antigravitySessions.js";
import { listClaudeSessions, readClaudeTranscript } from "./claudeSessions.js";
import { listCodexSessions, readCodexTranscript } from "./codexSessions.js";
import type {
  ExternalSessionOptions,
  ExternalSessionScope,
  ExternalSessionSource,
  ExternalSessionSummary,
  ExternalTranscript,
} from "./types.js";
import { listVibeSessions, readVibeTranscript } from "./vibeSessions.js";

export {
  externalProviderId,
  externalTranscriptToConversationMessages,
} from "./importTranscript.js";
export { buildExternalResumeLaunch } from "./resumeLaunch.js";
export * from "./types.js";

/** Native sessions for one CLI, newest first. Stores are read-only inputs; missing stores yield []. */
export function listExternalSessions(
  source: ExternalSessionSource,
  scope: ExternalSessionScope,
  options: ExternalSessionOptions = {},
): Promise<ExternalSessionSummary[]> {
  switch (source) {
    case "claude":
      return listClaudeSessions(scope, options);
    case "codex":
      return listCodexSessions(scope, options);
    case "antigravity":
      return listAntigravitySessions(scope, options);
    case "vibe":
      return listVibeSessions(scope, options);
  }
}

export function readExternalTranscript(
  summary: ExternalSessionSummary,
  options: ExternalSessionOptions = {},
): Promise<ExternalTranscript> {
  switch (summary.source) {
    case "claude":
      return readClaudeTranscript(summary);
    case "codex":
      return readCodexTranscript(summary);
    case "antigravity":
      return readAntigravityTranscript(summary, options);
    case "vibe":
      return readVibeTranscript(summary);
  }
}
