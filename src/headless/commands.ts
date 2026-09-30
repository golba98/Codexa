import { realpathSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { LaunchArgs } from "../config/launchArgs.js";
import { getProviderRuntime, discoverProviderModels } from "../core/providerRuntime/registry.js";
import { isKnownProviderId } from "../core/providerLauncher/registry.js";
import { discoverLocalModels } from "../core/providerRuntime/local.js";
import { resolveWorkspaceRoot } from "../core/workspace/workspaceRoot.js";
import { resolveUbumeWorkspaceDataDir } from "../core/workspace/appData.js";
import { ConversationStore } from "../core/workspace/conversationStore.js";
import { inspectOwnership } from "../core/workspace/ownership.js";
import { CheckpointStore, pendingFileRecoveries } from "../core/workspace/checkpoints.js";
import { inspectionEntries } from "../ui/timeline/inspection.js";
import { CommandError, resolveExecutionContext } from "./context.js";
import { doctor, listProviderStatus, packageVersion, redact } from "./diagnostics.js";
import { parseHeadlessExecArgs } from "./execArgs.js";
import { createHeadlessExecTiming, type HeadlessExecIo } from "./execRunner.js";
import { runSavedExec } from "./savedExec.js";

export const TERMINAL_COMMANDS = ["exec", "doctor", "status", "config", "providers", "models", "sessions"] as const;
export interface CommandEnvelope { schemaVersion: 1; command: string; ok: boolean; data: unknown; error: { code: string; message: string } | null }
export const terminalHelp = `Ubume ${packageVersion()}
Usage:
  ubume                           Open the interactive terminal UI.
  ubume doctor [--probe]           Diagnose local setup; --probe checks auth/network.
  ubume status                    Show workspace, route, ownership and recovery state.
  ubume config                    Show effective configuration and its sources.
  ubume providers                 List providers and local availability.
  ubume models [--provider ID] [--refresh]
  ubume sessions list
  ubume sessions show ID
  ubume sessions transcript ID
  ubume sessions diff ID [--turn NUMBER] [--file PATH]
  ubume exec [options] "prompt"
  ubume exec --stdin               Read a prompt from piped stdin.
  ubume exec --resume ID "prompt"  Continue a saved session.

All terminal commands accept --cwd DIRECTORY, --json, and --help.
Exec options: --provider ID, --model MODEL, --reasoning EFFORT, --profile NAME,
  -c key=value, --prompt TEXT, --file PATH (repeatable), --no-save, --timing,
  --ubume-prompt-policy raw|wrapped (default raw), --skip-git-repo-check.
Normal exec runs save by default; benchmark runs are transient. Session IDs and
activity go to stderr; answers go to stdout. --json emits one versioned object.
Use -- before a prompt containing option-like words. Diagnostics never send a model prompt.
`;
function launchArgs(): LaunchArgs {
  return { help: false, version: false, initialPrompt: null, profile: null, configOverrides: [], passthroughArgs: [], modelOverride: null, noClear: false };
}
export function commandWorkspace(cwd?: string): string {
  let workspace: string;
  try { workspace = realpathSync(cwd ? resolve(cwd) : resolveWorkspaceRoot()); }
  catch { throw new CommandError("Workspace directory does not exist or is inaccessible.", 2, "USAGE"); }
  if (!statSync(workspace).isDirectory()) throw new CommandError("--cwd must select a directory.", 2, "USAGE");
  return workspace;
}
async function readPrompt(input: AsyncIterable<string | Buffer>, signal?: AbortSignal): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  const iterator = input[Symbol.asyncIterator]();
  const interrupted = () => new CommandError("Run interrupted.", 130, "INTERRUPTED");
  let abort: (() => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    abort = () => reject(interrupted());
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
  try {
    while (true) {
      const next = await Promise.race([iterator.next(), cancellation]);
      if (signal?.aborted) throw interrupted();
      if (next.done) break;
      const chunk = next.value;
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += value.length;
      if (bytes > 8 * 1024 * 1024) throw new CommandError("Stdin prompt exceeds 8 MiB.", 2, "USAGE");
      chunks.push(value);
    }
  } finally {
    if (abort) signal?.removeEventListener("abort", abort);
    // A custom iterator's return may wait for its outstanding next call.
    // Request cleanup without delaying cancellation.
    void Promise.resolve().then(() => iterator.return?.()).catch(() => undefined);
  }
  const prompt = new TextDecoder("utf8", { fatal: true }).decode(Buffer.concat(chunks));
  if (!prompt.trim()) throw new CommandError("Stdin prompt is empty.", 2, "USAGE");
  return prompt;
}
export async function runTerminalCommand(argv: readonly string[], io: HeadlessExecIo = { stdout: process.stdout, stderr: process.stderr }, options: { signal?: AbortSignal; stdin?: AsyncIterable<string | Buffer> } = {}): Promise<number> {
  let json = argv.includes("--json");
  let command = argv[0] ?? "help";
  let extraSecrets: string[] = [];
  const emit = (data: unknown, exitCode = 0, error: CommandEnvelope["error"] = null, human?: string) => {
    if (options.signal?.aborted && exitCode === 0) { exitCode = 130; error = { code: "INTERRUPTED", message: "Command interrupted." }; }
    const envelope: CommandEnvelope = { schemaVersion: 1, command, ok: exitCode === 0, data, error };
    if (json) io.stdout.write(`${JSON.stringify(redact(envelope, extraSecrets))}\n`);
    else if (error) io.stderr.write(`${String(redact(error.message, extraSecrets))}\n`);
    else io.stdout.write(`${String(redact(human ?? JSON.stringify(data, null, 2), extraSecrets))}\n`);
    return exitCode;
  };
  try {
    if (command === "--json") { command = argv[1] ?? "help"; argv = [command, ...argv.slice(2), "--json"]; }
    if (command === "help" || command === "--help" || command === "-h") return emit({ help: terminalHelp }, 0, null, terminalHelp.trimEnd());
    if (command === "exec" || command === "--headless-benchmark") {
      const parsed = parseHeadlessExecArgs(argv.slice(1));
      if (!parsed.ok) throw new CommandError(parsed.error, 2, "USAGE");
      const args = parsed.value;
      json = args.json;
      if (args.help) return emit({ help: terminalHelp }, 0, null, terminalHelp.trimEnd());
      if (args.stdin && !options.stdin && process.stdin.isTTY) throw new CommandError("--stdin requires piped or redirected input.", 2, "USAGE");
      const prompt = args.stdin ? await readPrompt(options.stdin ?? process.stdin, options.signal) : args.prompt;
      const workspace = commandWorkspace(args.cwd);
      const output = json ? { stdout: { write: (_text: string) => true }, stderr: io.stderr } : io;
      const result = await runSavedExec({ prompt, workspaceRoot: workspace, launchArgs: args.launchArgs, providerId: args.providerId, resumeId: args.resumeId, noSave: args.noSave || command === "--headless-benchmark" || process.env.UBUME_HEADLESS_BENCHMARK === "1", files: args.files, promptPolicy: args.promptPolicy, signal: options.signal,
        benchmarkDiagnostics: createHeadlessExecTiming({ enabled: args.timing || process.env.UBUME_EXEC_TIMING === "1", stderr: io.stderr, startTimeMs: Number(process.env.UBUME_EXEC_TIMING_EPOCH_MS) || undefined }),
      }, output);
      if (json) return emit({ text: result.text ?? "", sessionId: result.sessionId ?? null }, result.exitCode, result.exitCode === 0 ? null : { code: result.exitCode === 130 ? "INTERRUPTED" : "RUN_FAILED", message: result.error ?? "Run failed." });
      if (result.text && !result.text.endsWith("\n")) io.stdout.write("\n");
      return result.exitCode;
    }
    const positional: string[] = [];
    const values = new Map<string, string>();
    const flags = new Set<string>();
    const allowed = new Set(["--json", "--cwd", "--help", "-h", ...(command === "doctor" ? ["--probe"] : command === "models" ? ["--provider", "--refresh"] : command === "sessions" ? ["--turn", "--file"] : [])]);
    for (let i = 1; i < argv.length; i++) {
      const arg = argv[i]!;
      if (!arg.startsWith("-")) { positional.push(arg); continue; }
      const name = arg.split("=")[0]!;
      if (!allowed.has(name)) throw new CommandError(`Unknown option: ${name}`, 2, "USAGE");
      if (["--cwd", "--provider", "--turn", "--file"].includes(name)) {
        const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++i];
        if (!value || value.startsWith("--")) throw new CommandError(`Missing value for ${name}.`, 2, "USAGE");
        values.set(name, value);
      } else { if (arg.includes("=")) throw new CommandError(`Unexpected value for ${name}.`, 2, "USAGE"); flags.add(name); }
    }
    if (flags.has("--help") || flags.has("-h")) return emit({ help: terminalHelp }, 0, null, terminalHelp.trimEnd());
    const workspace = commandWorkspace(values.get("--cwd"));
    const dataRoot = resolveUbumeWorkspaceDataDir(workspace, { readOnly: true });
    const store = new ConversationStore(workspace, { rootDir: join(dataRoot, "conversations"), onDiagnostic: (message) => io.stderr.write(`${message}\n`) });
    if (command === "sessions") {
      const [action, id, ...rest] = positional;
      if (rest.length || !["list", "show", "transcript", "diff"].includes(action ?? "") || (action === "list" ? !!id : !id)) throw new CommandError("Use sessions list, show ID, transcript ID, or diff ID.", 2, "USAGE");
      if (action !== "diff" && (values.has("--turn") || values.has("--file"))) throw new CommandError("--turn and --file apply only to sessions diff.", 2, "USAGE");
      if (action === "list") { const sessions = store.list(); return emit(sessions, 0, null, sessions.length ? sessions.map((s) => `${s.id}  ${s.updatedAt}  ${s.providerId}/${s.modelId}  ${s.title}`).join("\n") : "No saved sessions."); }
      if (!/^chat_[A-Za-z0-9-]+$/.test(id!)) throw new CommandError("Invalid session ID.", 2, "USAGE");
      const record = store.load(id!);
      if (!record) throw new CommandError(`Session ${id} could not be loaded.`);
      if (action === "show") return emit({ ...record.metadata, draft: record.session?.draft ?? "", queuedPrompts: record.session?.queue.length ?? 0, checkpoints: record.session?.checkpoints.length ?? 0, ownership: inspectOwnership(workspace, id!), pendingRecovery: existsSync(join(dataRoot, "checkpoints", id!, "restore.json")) });
      if (action === "transcript") {
        const entries = record.session ? inspectionEntries(record.session.events) : record.messages.map((message, i) => ({ id: String(i), title: message.role, details: [message.content, message.activitySummary].filter(Boolean).join("\n") }));
        return emit(entries, 0, null, entries.map((e) => `${e.title}\n${e.details}`).join("\n\n"));
      }
      const points = record.session?.checkpoints ?? [];
      const turn = values.get("--turn");
      if (turn !== undefined && !/^[1-9]\d*$/.test(turn)) throw new CommandError("--turn must be a positive turn number.", 2, "USAGE");
      const point = turn ? points.find((p) => p.turnId === Number(turn)) : undefined;
      if (turn && !point) throw new CommandError(`Turn ${turn} has no file checkpoint.`);
      const before = point?.before ?? points[0]?.before;
      const after = point?.after ?? (turn ? undefined : record.session?.restoredFileBoundary ?? points.at(-1)?.after);
      if (!before || !after) throw new CommandError("No finalized file checkpoint is available for this selection.");
      const checkpoints = new CheckpointStore(workspace, id!, dataRoot);
      const paths = checkpoints.changed(before, after);
      const file = values.get("--file");
      if (file && !paths.includes(file)) throw new CommandError(`No recorded change for ${file}.`);
      const patches = await Promise.all((file ? [file] : paths).map(async (path) => ({ path, patch: await checkpoints.patch(before, after, path) })));
      return emit({ complete: before.complete && after.complete, skipped: [...new Set([...before.skipped, ...after.skipped])], patches }, 0, null, patches.map((p) => p.patch).join("\n") || "No supported text-file changes.");
    }
    if (positional.length) throw new CommandError(`Unexpected arguments for ${command}.`, 2, "USAGE");
    const context = resolveExecutionContext(workspace, launchArgs(), { inspect: true });
    extraSecrets = Object.values(context.config.providers ?? {}).flatMap((provider) => provider?.apiKey ? [provider.apiKey] : []);
    if (command === "config") return emit({ runtime: context.runtime, providers: context.config, diagnostics: context.layered.diagnostics });
    if (command === "providers") return emit(listProviderStatus(context.config, workspace));
    if (command === "status") return emit({ version: packageVersion(), workspace, route: context.route, storage: dataRoot, execution: inspectOwnership(workspace, "execution"), pendingRecoverySessions: await pendingFileRecoveries(workspace), sessions: store.list().map((s) => ({ id: s.id, ownership: inspectOwnership(workspace, s.id), pendingRecovery: existsSync(join(dataRoot, "checkpoints", s.id, "restore.json")) })) });
    if (command === "doctor") {
      const checks = await doctor(workspace, context.config, context.route.providerId, flags.has("--probe"));
      const pending = await pendingFileRecoveries(workspace);
      if (pending.length) checks.push({ name: "recovery", status: "fail", message: `Pending file recovery: resume ${pending.join(", ")}.` });
      for (const layer of context.layered.diagnostics.layers) if (layer.status === "error" || layer.status === "blocked") checks.push({ name: `config:${layer.label}`, status: layer.status === "error" ? "fail" : "warn", message: layer.reason ?? layer.status });
      return emit({ workspace, checks }, checks.some((c) => c.status === "fail") ? 1 : 0, null, checks.map((c) => `${c.status.toUpperCase().padEnd(7)} ${c.name}: ${c.message}`).join("\n"));
    }
    if (command === "models") {
      const id = values.get("--provider") ?? context.route.providerId;
      if (!isKnownProviderId(id)) throw new CommandError(`Unknown provider: ${id}`, 2, "USAGE");
      const runtime = getProviderRuntime(id);
      const result = flags.has("--refresh") && runtime.refreshModels
        ? await runtime.refreshModels({ cwd: workspace, localConfig: context.config.providers?.local, localBackend: context.config.providers?.local?.localBackend })
        : id === "local" ? discoverLocalModels(context.config.providers?.local, context.config.providers?.local?.localBackend) : discoverProviderModels(id);
      return emit(result, result.status === "ready" ? 0 : 3);
    }
    throw new CommandError(`Unknown command: ${command}`, 2, "USAGE");
  } catch (error) {
    const code = options.signal?.aborted ? 130 : error instanceof CommandError ? error.exitCode : typeof (error as { exitCode?: unknown })?.exitCode === "number" ? (error as { exitCode: number }).exitCode : 1;
    return emit(null, code, { code: code === 130 ? "INTERRUPTED" : error instanceof CommandError ? error.code : code === 3 ? "BUSY" : "FAILED", message: error instanceof Error ? error.message : String(error) });
  }
}
