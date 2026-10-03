import { closeLocalHarnessSession } from "../core/providerRuntime/localHarness/runtime.js";
import { resolveUbumeWorkspaceDataDir } from "../core/workspace/appData.js";
import { assertFileRecoveryReady, CheckpointStore } from "../core/workspace/checkpoints.js";
import { type ConversationRecord, ConversationStore } from "../core/workspace/conversationStore.js";
import { acquireOwnership } from "../core/workspace/ownership.js";
import { expandFileAttachments, readFileAttachment } from "../core/workspace/workspaceFiles.js";
import { createRunEvent } from "../session/chatLifecycle.js";
import { conversationMessagesToTimeline } from "../session/conversation.js";
import { ToolOutputBudget } from "../session/toolOutput.js";
import type { AssistantEvent } from "../session/types.js";
import { restoredEvents, type WorkbenchSnapshot } from "../session/workbench.js";
import { CommandError, resolveExecutionContext } from "./context.js";
import { redact } from "./diagnostics.js";
import {
  type HeadlessExecIo,
  type HeadlessExecOptions,
  type HeadlessExecResult,
  runHeadlessExec,
} from "./execRunner.js";

export interface SavedExecOptions extends HeadlessExecOptions {
  noSave?: boolean;
  resumeId?: string;
  files?: string[];
}
export async function runSavedExec(
  options: SavedExecOptions,
  io: HeadlessExecIo,
): Promise<HeadlessExecResult & { sessionId?: string }> {
  const workspace = options.workspaceRoot!;
  const dataRoot = resolveUbumeWorkspaceDataDir(workspace, { readOnly: options.noSave ?? false });
  const store = new ConversationStore(workspace, {
    ownership: true,
    onDiagnostic: (message) => io.stderr.write(`${message}\n`),
  });
  let execution: ReturnType<typeof acquireOwnership> | undefined;
  let record: ConversationRecord | undefined;
  let harnessToClose: string | undefined;
  try {
    if (options.resumeId) {
      store.acquire(options.resumeId);
      record = store.load(options.resumeId) ?? undefined;
      if (!record) throw new CommandError(`Session ${options.resumeId} could not be loaded.`);
      if (record.session?.plan.kind !== undefined && record.session.plan.kind !== "idle")
        throw new CommandError(
          "This session is awaiting plan review. Open it in the TUI before executing more work.",
        );
      // Keep a crash-interrupted answer in provider context exactly once.
      const run = record.session?.events.findLast((event) => event.type === "run");
      const answer = record.session?.events.findLast((event) => event.type === "assistant");
      if (
        run?.type === "run" &&
        run.status === "running" &&
        answer?.type === "assistant" &&
        answer.turnId === run.turnId &&
        record.messages.at(-1)?.role === "user"
      ) {
        record.messages.push({
          role: "assistant",
          content: `${answer.contentChunks.join("") || answer.content}\n\n[Run interrupted before session closed]`,
          turnId: run.turnId,
        });
      }
    }
    const context =
      options.context ??
      resolveExecutionContext(workspace, options.launchArgs, {
        providerId: options.providerId,
        saved: record,
      });
    const secrets = Object.values(context.config.providers ?? {}).flatMap((provider) =>
      provider?.apiKey ? [provider.apiKey] : [],
    );
    const originalIo = io;
    io = {
      stdout: originalIo.stdout,
      stderr: { write: (text: string) => originalIo.stderr.write(String(redact(text, secrets))) },
    };
    execution = acquireOwnership(workspace, "execution");
    try {
      await assertFileRecoveryReady(workspace, options.resumeId);
    } catch (error) {
      throw new CommandError((error as Error).message);
    }
    if (!options.noSave) {
      record ??= store.createConversation(context.route);
      store.acquire(record.metadata.id);
      record.metadata = { ...record.metadata, ...context.route };
    }
    const attachments = new Map<string, Awaited<ReturnType<typeof readFileAttachment>>>();
    let submitted = options.prompt;
    for (const [index, path] of (options.files ?? []).entries()) {
      const token = `\u0001ubume-file-${index}\u0002`;
      attachments.set(token, await readFileAttachment(workspace, path));
      submitted += `\n${token}`;
    }
    submitted = await expandFileAttachments(submitted, attachments, workspace);
    let eventId = Math.max(0, ...(record?.session?.events.map((event) => event.id) ?? []));
    const existingEvents = record?.session
      ? restoredEvents(record.session.events)
      : conversationMessagesToTimeline(record?.messages ?? [], () => ++eventId);
    const turnId =
      Math.max(
        0,
        ...existingEvents.map((event) => ("turnId" in event ? event.turnId : 0)),
        ...(record?.messages.map((message) => message.turnId ?? 0) ?? []),
      ) + 1;
    const now = Date.now();
    const session: WorkbenchSnapshot = record?.session
      ? { ...record.session, events: existingEvents, uiState: { kind: "IDLE" } }
      : {
          version: 1,
          events: existingEvents,
          uiState: { kind: "IDLE" },
          plan: { kind: "idle" },
          draft: "",
          cursor: 0,
          history: [],
          pastes: [],
          images: [],
          files: [],
          queue: [],
          checkpoints: [],
        };
    const checkpointStore = record
      ? new CheckpointStore(workspace, record.metadata.id, dataRoot)
      : undefined;
    if (checkpointStore) await checkpointStore.recover();
    const point = checkpointStore
      ? {
          id: String(++eventId),
          turnId,
          messageCount: record!.messages.length,
          prompt: options.prompt,
          before: await checkpointStore.capture(),
          after: undefined as Awaited<ReturnType<CheckpointStore["capture"]>> | undefined,
        }
      : undefined;
    if (point) session.checkpoints = [...session.checkpoints, point];
    session.restoredFileBoundary = undefined;
    session.events.push({
      id: ++eventId,
      type: "user",
      createdAt: now,
      turnId,
      prompt: options.prompt,
    });
    const run = createRunEvent({
      id: ++eventId,
      turnId,
      backendId: context.runtime.provider,
      backendLabel: context.provider.label,
      runtime: context.runtime,
      prompt: submitted,
      startedAtMs: now,
    });
    session.events.push(run);
    let assistant: AssistantEvent | undefined;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      if (record) {
        record.session = session;
        store.save(record);
      }
    };
    const scheduleSave = () => {
      saveTimer ??= setTimeout(() => {
        saveTimer = undefined;
        try {
          save();
        } catch (error) {
          io.stderr.write(`[ubume exec] save: ${(error as Error).message}\n`);
        }
      }, 200);
    };
    const setAnswer = (text: string) => {
      if (!assistant) {
        assistant = {
          id: ++eventId,
          type: "assistant",
          createdAt: Date.now(),
          turnId,
          content: "",
          contentChunks: [],
        };
        session.events.push(assistant);
      }
      assistant.content = text;
      assistant.contentChunks = [];
      scheduleSave();
    };
    const history = record ? { ...record, messages: [...record.messages] } : undefined;
    record?.messages.push({
      role: "user",
      content: options.prompt,
      submittedContent: submitted,
      turnId,
      createdAt: now,
    });
    session.history = [options.prompt, ...session.history].slice(0, 50);
    save();
    const budget = new ToolOutputBudget();
    let result: HeadlessExecResult;
    try {
      result = await runHeadlessExec(
        {
          ...options,
          prompt: submitted,
          saved: history,
          context,
          handlers: {
            onAssistantDelta: (chunk) => setAnswer((assistant?.content ?? "") + chunk),
            onResponse: setAnswer,
            onProgress: (update) => {
              const previous = run.progressEntries.find((entry) => entry.id === update.id);
              if (previous) previous.text = update.text;
              else if (run.progressEntries.length < 500)
                run.progressEntries.push({
                  ...update,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                  sequence: run.progressEntries.length + 1,
                  pendingNewlineCount: 0,
                  blocks: [],
                });
              scheduleSave();
            },
            onToolActivity: (activity) => {
              const bounded = budget.bound(activity);
              const index = run.toolActivities.findIndex((item) => item.id === activity.id);
              if (index >= 0) run.toolActivities[index] = bounded;
              else if (run.toolActivities.length < 1000) run.toolActivities.push(bounded);
              scheduleSave();
            },
            onLocalContextCheckpoint: (checkpoint) => {
              if (record) record.metadata.localContextCheckpoint = checkpoint;
              scheduleSave();
            },
            onNativeSession: (reference) => {
              if (record)
                record.metadata.nativeSessions = [
                  ...(record.metadata.nativeSessions ?? []).filter(
                    (previous) =>
                      previous.source !== reference.source ||
                      previous.sessionId !== reference.sessionId,
                  ),
                  reference,
                ];
              scheduleSave();
            },
            onLocalHarnessSession: (metadata, id) => {
              harnessToClose = id;
              if (record) {
                if (metadata) record.metadata.localHarnessSession = metadata;
                else delete record.metadata.localHarnessSession;
              }
              scheduleSave();
            },
            onToolApproval: async () => "deny",
          },
        },
        io,
      );
    } finally {
      if (saveTimer) clearTimeout(saveTimer);
    }
    if (result.text) setAnswer(result.text);
    if (saveTimer) clearTimeout(saveTimer);
    run.status =
      result.exitCode === 0 ? "completed" : result.exitCode === 130 ? "canceled" : "failed";
    run.summary = result.exitCode === 0 ? "Completed" : (result.error ?? "Run failed");
    run.durationMs = Date.now() - now;
    for (const tool of run.toolActivities)
      if (tool.status === "running") {
        tool.status = "failed";
        tool.summary = "Interrupted";
      }
    if (result.text)
      record?.messages.push({
        role: "assistant",
        content: result.text + (result.exitCode === 130 ? "\n\n[Run interrupted]" : ""),
        turnId,
        createdAt: Date.now(),
        activitySummary: run.toolActivities
          .map((tool) => `${tool.status}: ${tool.command}`)
          .join("\n"),
      });
    if (point && checkpointStore) point.after = await checkpointStore.capture();
    save();
    if (record) io.stderr.write(`[ubume exec] session: ${record.metadata.id}\n`);
    return {
      ...result,
      ...(result.error ? { error: String(redact(result.error, secrets)) } : {}),
      ...(record ? { sessionId: record.metadata.id } : {}),
    };
  } finally {
    try {
      if (harnessToClose) await closeLocalHarnessSession(harnessToClose);
    } finally {
      execution?.release();
      store.release();
    }
  }
}
