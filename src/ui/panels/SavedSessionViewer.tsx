import { useCallback } from "react";
import type { ExternalTranscriptEntry } from "../../core/externalSessions/types.js";
import { readOwnedConversation, type SessionSummary } from "../../session/sessionCatalog.js";
import { inspectionEntries } from "../timeline/inspection.js";
import { SessionTranscriptViewer } from "./ExternalSessionViewer.js";

export function SavedSessionViewer({
  session,
  onBack,
  onLocateWorkspace,
}: {
  session: SessionSummary;
  onBack: () => void;
  onLocateWorkspace: () => void;
}) {
  const loadTranscript = useCallback(async () => {
    if (session.ref.kind !== "ubume") throw new Error("Expected a Ubume conversation.");
    const record = readOwnedConversation(session.ref);
    const entries: ExternalTranscriptEntry[] = record.session
      ? inspectionEntries(record.session.events).map((entry) => ({
          id: entry.id,
          kind: entry.id.startsWith("user-")
            ? "user"
            : entry.id.startsWith("assistant-")
              ? "assistant"
              : entry.id.startsWith("tool-")
                ? "tool"
                : "note",
          title: entry.title,
          text: entry.details,
        }))
      : record.messages.map((message, index) => ({
          id: String(index),
          kind: message.role,
          title: message.role === "user" ? "You" : "Assistant",
          text: [message.content, message.activitySummary].filter(Boolean).join("\n\n"),
        }));
    return {
      entries,
      notice: `Original workspace: ${session.workspaceRoot ?? "not recorded"}. Locate the original folder to resume.`,
    };
  }, [session]);
  return (
    <SessionTranscriptViewer
      summary={{ title: session.title, cwd: session.workspaceRoot }}
      label="Ubume"
      loadTranscript={loadTranscript}
      onBack={onBack}
      onContinue={onLocateWorkspace}
      continueLabel="locate original folder"
    />
  );
}
