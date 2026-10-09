import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readdir, readFile } from "fs/promises";
import { parseTomlDocument } from "../../config/layeredConfig.js";
import { getHomeDir } from "../../config/settings.js";
import { formatConversationHistory } from "../../session/conversation.js";
import { resolveVibeExecutable } from "../executables/executableResolver.js";
import { vibeSessionDir } from "../externalSessions/vibeSessions.js";
import { resolveCatalogModel } from "../models/modelSelection.js";
import {
  type CommandResult,
  type CommandSpec,
  type CommandStreamHandlers,
  runCommand,
} from "../process/commandRunner.js";
import {
  type LaunchProviderCliOptions,
  launchProviderCli,
  type ProviderLaunchResult,
} from "../providerLauncher/launcher.js";
import type { ProviderConfig } from "../providerLauncher/types.js";
import { createRunControl } from "../providers/runControl.js";
import type { BackendRunHandlers } from "../providers/types.js";
import { errorMessage, isRecord } from "../shared/values.js";
import { sanitizeTerminalOutput } from "../terminal/terminalSanitize.js";
import { fetchMistralModels, resolveMistralConnection } from "./mistralDiscovery.js";
import type {
  ProviderChatRequest,
  ProviderModel,
  ProviderModelDiscoveryResult,
  ProviderRouteValidationResult,
  ProviderRuntime,
} from "./types.js";

const VIBE_RUN_TIMEOUT_MS = 600_000;
const VIBE_DEFAULT_MODEL_LABEL = "Vibe default";

export const MISTRAL_VIBE_MISSING_MESSAGE =
  "`vibe` is not available. Install Mistral Vibe CLI and authenticate it with `vibe --setup`, then try again.";

export const MISTRAL_VIBE_AUTH_MESSAGE =
  "Mistral Vibe CLI is not authenticated. Run `vibe` in a terminal and sign in, then retry.";

interface VibeModelDetection {
  modelId: string;
  source: "environment" | "project-config" | "user-config" | "default";
  configPath: string | null;
}

function readActiveModel(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    const parsed = parseTomlDocument(readFileSync(filePath, "utf-8"));
    return typeof parsed.active_model === "string" && parsed.active_model.trim()
      ? parsed.active_model.trim()
      : null;
  } catch {
    return null;
  }
}

function findProjectVibeConfig(cwd: string, vibeHome: string): string | null {
  let current = resolve(cwd);
  const stopDirectory = dirname(resolve(vibeHome));

  while (current !== stopDirectory) {
    const candidate = join(current, ".vibe", "config.toml");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export function detectVibeActiveModel(
  options: { cwd?: string; env?: NodeJS.ProcessEnv; homeDirectory?: string } = {},
): VibeModelDetection {
  const env = options.env ?? process.env;
  const environmentModel = env.VIBE_ACTIVE_MODEL?.trim();
  if (environmentModel) {
    return { modelId: environmentModel, source: "environment", configPath: null };
  }

  const homeDirectory = options.homeDirectory ?? getHomeDir();
  const vibeHome = env.VIBE_HOME?.trim() || join(homeDirectory, ".vibe");
  const projectConfig = findProjectVibeConfig(options.cwd ?? process.cwd(), vibeHome);
  if (projectConfig) {
    const projectModel = readActiveModel(projectConfig);
    if (projectModel) {
      return { modelId: projectModel, source: "project-config", configPath: projectConfig };
    }
  }

  const userConfig = join(vibeHome, "config.toml");
  const userModel = readActiveModel(userConfig);
  if (userModel) {
    return { modelId: userModel, source: "user-config", configPath: userConfig };
  }

  return { modelId: VIBE_DEFAULT_MODEL_LABEL, source: "default", configPath: null };
}

interface VibeConfigModelEntry {
  name: string;
  alias: string;
  provider: string | null;
}

// Vibe resolves `active_model` (and the VIBE_ACTIVE_MODEL override) against the
// model *alias*, which defaults to the model name when omitted — so the alias is
// the id Ubume must select and pass back.
function readVibeModelEntries(filePath: string): VibeConfigModelEntry[] {
  if (!existsSync(filePath)) return [];
  try {
    const parsed = parseTomlDocument(readFileSync(filePath, "utf-8"));
    const rawModels = (parsed as Record<string, unknown>).models;
    if (!Array.isArray(rawModels)) return [];
    const entries: VibeConfigModelEntry[] = [];
    for (const raw of rawModels) {
      if (!raw || typeof raw !== "object") continue;
      const record = raw as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      if (!name) continue;
      const alias =
        typeof record.alias === "string" && record.alias.trim() ? record.alias.trim() : name;
      entries.push({
        name,
        alias,
        provider:
          typeof record.provider === "string" && record.provider.trim()
            ? record.provider.trim()
            : null,
      });
    }
    return entries;
  } catch {
    return [];
  }
}

function vibeEntryToProviderModel(entry: VibeConfigModelEntry): ProviderModel {
  return {
    id: entry.alias,
    modelId: entry.alias,
    label: entry.alias,
    description: entry.provider ? `${entry.name} via ${entry.provider}` : entry.name,
    defaultReasoningLevel: null,
    supportedReasoningLevels: null,
    source: "config",
    raw: entry,
  };
}

export function listVibeConfiguredModels(
  options: { cwd?: string; env?: NodeJS.ProcessEnv; homeDirectory?: string } = {},
): { models: ProviderModel[]; configPath: string | null } {
  const env = options.env ?? process.env;
  const homeDirectory = options.homeDirectory ?? getHomeDir();
  const vibeHome = env.VIBE_HOME?.trim() || join(homeDirectory, ".vibe");
  const projectConfig = findProjectVibeConfig(options.cwd ?? process.cwd(), vibeHome);
  const userConfig = join(vibeHome, "config.toml");

  const seen = new Set<string>();
  const models: ProviderModel[] = [];
  let configPath: string | null = null;
  for (const candidate of [projectConfig, userConfig]) {
    if (!candidate) continue;
    const entries = readVibeModelEntries(candidate);
    if (entries.length > 0 && !configPath) configPath = candidate;
    for (const entry of entries) {
      if (seen.has(entry.alias)) continue;
      seen.add(entry.alias);
      models.push(vibeEntryToProviderModel(entry));
    }
  }
  return { models, configPath };
}

let liveMistralCatalog: ProviderModelDiscoveryResult | null = null;

export function discoverMistralVibeModels(cwd = process.cwd()): ProviderModelDiscoveryResult {
  if (liveMistralCatalog) return liveMistralCatalog;
  const detected = detectVibeActiveModel({ cwd });
  const listed = listVibeConfiguredModels({ cwd });

  // The active model must be first: registry consumers read models[0] as the default route model.
  const models: ProviderModel[] = [];
  const activeFromList = listed.models.find((model) => model.modelId === detected.modelId);
  if (activeFromList) {
    models.push(activeFromList, ...listed.models.filter((model) => model !== activeFromList));
  } else {
    models.push(
      {
        id: detected.modelId,
        modelId: detected.modelId,
        label: detected.modelId,
        description: "Active model reported by Mistral Vibe configuration.",
        defaultReasoningLevel: null,
        supportedReasoningLevels: null,
        source: detected.source === "default" ? "fallback" : "config",
        raw: {
          source: detected.source,
          configPath: detected.configPath,
        },
      },
      ...listed.models,
    );
  }

  return {
    status: "ready",
    providerId: "mistral",
    backendKind: "mistral-vibe-cli-auth",
    models,
    diagnostics: {
      selectedModel: detected.modelId,
      modelSource: detected.source,
      configPath: detected.configPath ?? listed.configPath,
      modelCount: models.length,
    },
  };
}

export async function launchMistralVibeCli(
  provider: ProviderConfig,
  options: LaunchProviderCliOptions & {
    resolveExecutable?: (cwd: string) => Promise<string | null>;
  },
): Promise<ProviderLaunchResult> {
  const resolveExecutable =
    options.resolveExecutable ?? ((cwd: string) => resolveVibeExecutable({ cwd }));
  const executable = await resolveExecutable(options.cwd);
  if (!executable) {
    return { status: "missing-command", message: MISTRAL_VIBE_MISSING_MESSAGE };
  }

  return launchProviderCli(
    {
      ...provider,
      launchCommand: { executable, args: [] },
    },
    options,
  );
}

// ─── Session continuation ────────────────────────────────────────────────────
// Vibe persists every programmatic run as a session directory; passing the last
// session id back via --resume keeps conversation context across Ubume turns.

export async function findLatestVibeSession(options: {
  workspaceRoot: string;
  sinceMs: number;
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
}): Promise<string | null> {
  try {
    const env = options.env ?? process.env;
    const homeDirectory = options.homeDirectory ?? getHomeDir();
    const sessionRoot = await vibeSessionDir({ env, home: homeDirectory });
    const workspaceRoot = resolve(options.workspaceRoot);
    const entries = await readdir(sessionRoot);

    let latestStart = -Infinity;
    let latestSessionId: string | null = null;
    for (const entry of entries) {
      try {
        const meta = JSON.parse(await readFile(join(sessionRoot, entry, "meta.json"), "utf-8")) as {
          session_id?: unknown;
          start_time?: unknown;
          environment?: { working_directory?: unknown };
        };
        if (typeof meta.session_id !== "string" || typeof meta.start_time !== "string") continue;
        if (meta.environment?.working_directory !== workspaceRoot) continue;
        const startMs = Date.parse(meta.start_time);
        // 5s slack absorbs clock skew between Ubume's spawn timestamp and vibe's own start_time.
        if (!Number.isFinite(startMs) || startMs < options.sinceMs - 5_000) continue;
        if (startMs > latestStart) {
          latestStart = startMs;
          latestSessionId = meta.session_id;
        }
      } catch {
        continue;
      }
    }
    return latestSessionId;
  } catch {
    return null;
  }
}

// ─── Streaming output parsing ────────────────────────────────────────────────

function extractVibeText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (
          item &&
          typeof item === "object" &&
          typeof (item as { text?: unknown }).text === "string"
        ) {
          return (item as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function truncateForActivity(value: string, max = 120): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

interface VibeStreamParser {
  push: (chunk: string) => void;
  flush: () => void;
  finalText: () => string;
  assistantText: () => string;
}

// Parses `vibe -p --output streaming` stdout: one JSON LLMMessage per line, followed
// by the final assistant text repeated as plain text (which must not be emitted twice).
export function createVibeStreamParser(
  handlers: BackendRunHandlers,
  options: { startAfterUserPrompt?: string } = {},
): VibeStreamParser {
  let lineBuf = "";
  let accumulated = "";
  const plainLines: string[] = [];
  let sequence = 0;
  const runningTools = new Map<string, { command: string; startedAt: number }>();
  const resumePrompt = options.startAfterUserPrompt?.trim() || null;
  let acceptingCurrentTurn = resumePrompt === null;

  const handleMessage = (message: Record<string, unknown>) => {
    const role = message.role;
    if (!acceptingCurrentTurn) {
      if (role === "user" && extractVibeText(message.content).trim() === resumePrompt) {
        acceptingCurrentTurn = true;
      }
      return;
    }
    if (role !== "assistant" && role !== "tool") return;

    if (role === "tool") {
      const toolCallId = typeof message.tool_call_id === "string" ? message.tool_call_id : null;
      const running = toolCallId ? runningTools.get(toolCallId) : undefined;
      if (toolCallId && running) {
        runningTools.delete(toolCallId);
        handlers.onToolActivity?.({
          id: toolCallId,
          command: running.command,
          status: "completed",
          startedAt: running.startedAt,
          completedAt: Date.now(),
          output: extractVibeText(message.content),
          summary: truncateForActivity(extractVibeText(message.content)) || null,
        });
      }
      return;
    }

    const reasoning = extractVibeText(message.reasoning_content);
    if (reasoning.trim()) {
      handlers.onProgress?.({
        id: `vibe-reasoning-${++sequence}`,
        source: "reasoning",
        text: reasoning,
      });
    }

    const content = extractVibeText(message.content);
    if (content.trim()) {
      const chunk = accumulated ? `\n\n${content}` : content;
      accumulated += chunk;
      handlers.onAssistantDelta?.(chunk);
    }

    if (Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        if (!call || typeof call !== "object") continue;
        const record = call as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
        const name = typeof record.function?.name === "string" ? record.function.name : "tool";
        const args =
          typeof record.function?.arguments === "string" ? record.function.arguments : "";
        const id = typeof record.id === "string" ? record.id : `vibe-tool-${++sequence}`;
        const activity = {
          id,
          command: truncateForActivity(args ? `${name}(${args})` : name),
          startedAt: Date.now(),
        };
        runningTools.set(id, activity);
        handlers.onToolActivity?.({ ...activity, status: "running" });
      }
    }
  };

  const handleLine = (rawLine: string) => {
    const line = sanitizeTerminalOutput(rawLine).trim();
    if (!line) return;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof (parsed as { role?: unknown }).role === "string"
      ) {
        handleMessage(parsed as Record<string, unknown>);
        return;
      }
    } catch {
      // Not a JSON message: either a pre-stream notice or the trailing plain-text
      // duplicate of the final answer. Collected as fallback, never streamed.
    }
    plainLines.push(line);
  };

  return {
    push: (chunk) => {
      lineBuf += chunk;
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    },
    flush: () => {
      if (!lineBuf) return;
      const rest = lineBuf;
      lineBuf = "";
      handleLine(rest);
    },
    finalText: () => accumulated || plainLines.join("\n").trim(),
    assistantText: () => accumulated,
  };
}

// ─── In-Ubume run adapter ───────────────────────────────────────────────────

type VibeCommandRunner = (
  spec: CommandSpec,
  handlers: CommandStreamHandlers,
) => { result: Promise<CommandResult>; cancel: () => void; stopped?: Promise<void> };

interface RunMistralVibeDeps {
  runCommandImpl?: VibeCommandRunner;
  resolveExecutable?: (cwd: string) => Promise<string | null>;
  env?: NodeJS.ProcessEnv;
  findSessionImpl?: typeof findLatestVibeSession;
  now?: () => number;
}

function isVibeAuthFailure(stderr: string): boolean {
  return /api key|401|unauthorized|authentication/i.test(stderr);
}

export function runMistralVibe(
  request: ProviderChatRequest,
  handlers: BackendRunHandlers,
  deps: RunMistralVibeDeps = {},
): () => void {
  const control = createRunControl(handlers);
  let cancelled = false;
  let currentCancel: (() => void) | null = null;
  const now = deps.now ?? Date.now;
  const env = deps.env ?? process.env;
  const runImpl = deps.runCommandImpl ?? (runCommand as VibeCommandRunner);
  const resolveExecutable =
    deps.resolveExecutable ?? ((cwd: string) => resolveVibeExecutable({ cwd }));
  const findSessionImpl = deps.findSessionImpl ?? findLatestVibeSession;
  const workspaceRoot = request.workspaceRoot;

  handlers.onProgress?.({
    id: "mistral-route",
    source: "stdout",
    text: "Starting Mistral Vibe CLI",
  });

  const runAttempt = (executable: string, resumeSessionId: string | null) => {
    const args = [
      "-p",
      "--output",
      "streaming",
      "--trust",
      "--auto-approve",
      "--workdir",
      workspaceRoot,
    ];
    if (resumeSessionId) args.push("--resume", resumeSessionId);

    const modelId = request.route.modelId?.trim();
    const spawnEnv: NodeJS.ProcessEnv = { ...env };
    if (modelId && modelId !== VIBE_DEFAULT_MODEL_LABEL) {
      const discovered =
        request.modelDescriptor ?? resolveCatalogModel(liveMistralCatalog?.models ?? [], modelId);
      if (discovered) {
        const selected = request.route.reasoning;
        if (
          selected &&
          discovered.supportedReasoningLevels?.length &&
          !discovered.supportedReasoningLevels.some((level) => level.id === selected)
        ) {
          control.finish();
          handlers.onError(`Unsupported Mistral reasoning setting: ${selected}.`);
          return;
        }
        const connection = resolveMistralConnection(workspaceRoot, request.providerConfig, env);
        const configuredModel = connection.configuredModels.find(
          (item) =>
            isRecord(item) && item.name === discovered.modelId && item.provider === "mistral",
        );
        const inheritedThinking =
          isRecord(configuredModel) && typeof configuredModel.thinking === "string"
            ? configuredModel.thinking
            : "off";
        const thinking = discovered.supportedReasoningLevels?.length
          ? selected === "none"
            ? "low"
            : "high"
          : inheritedThinking;
        spawnEnv.VIBE_MODELS = JSON.stringify({
          [modelId]: {
            name: discovered.modelId,
            alias: modelId,
            provider: connection.providerName,
            thinking,
            thinking_levels: discovered.supportedReasoningLevels?.length
              ? ["low", "high"]
              : undefined,
            supports_images: discovered.capabilities?.vision === true,
            max_context_length: discovered.contextWindow ?? undefined,
          },
        });
        if (connection.apiKey) spawnEnv[connection.apiKeyEnv] = connection.apiKey;
        if (discovered.capabilities?.tools === false) spawnEnv.VIBE_ENABLED_TOOLS = "[]";
        if (request.providerConfig?.baseUrl)
          spawnEnv.VIBE_PROVIDERS = JSON.stringify([
            {
              name: "mistral",
              api_base: connection.baseUrl,
              api_key_env_var: connection.apiKeyEnv,
              backend: "mistral",
            },
          ]);
      }
      spawnEnv.VIBE_ACTIVE_MODEL = modelId;
    }

    const prompt =
      !resumeSessionId && request.conversationHistory?.length
        ? `Previous conversation:\n${formatConversationHistory(request.conversationHistory)}\n\nCurrent request:\n${request.prompt}`
        : request.prompt;
    const parser = createVibeStreamParser(
      handlers,
      resumeSessionId ? { startAfterUserPrompt: request.prompt } : undefined,
    );
    const spawnedAt = now();
    const runner = runImpl(
      {
        executable,
        args,
        cwd: workspaceRoot,
        env: spawnEnv,
        timeoutMs: VIBE_RUN_TIMEOUT_MS,
        stdinData: prompt,
      },
      {
        onStdout: (chunk) => {
          if (!cancelled) parser.push(chunk);
        },
        onProcessLifecycle: (event) => {
          handlers.onProcessLifecycle?.(event === "cancel" ? "cleanup" : event);
        },
      },
    );
    currentCancel = runner.cancel;
    control.track(runner.stopped ?? runner.result.then(() => undefined));

    runner.result
      .then(async (result) => {
        if (cancelled || result.status === "canceled") {
          control.finish();
          return;
        }
        parser.flush();

        if (result.status !== "completed" || result.exitCode !== 0) {
          if (isVibeAuthFailure(result.stderr)) {
            control.finish();
            handlers.onError(MISTRAL_VIBE_AUTH_MESSAGE, result.stderr);
            return;
          }
          if (result.status === "spawn_error" && result.errorCode === "ENOENT") {
            control.finish();
            handlers.onError(MISTRAL_VIBE_MISSING_MESSAGE);
            return;
          }
          if (
            resumeSessionId &&
            /(?:session[^\n]*(?:not found|does not exist|unsupported)|(?:not found|does not exist)[^\n]*session)/i.test(
              result.stderr,
            )
          ) {
            handlers.onProgress?.({
              id: "vibe-resume-retry",
              source: "stderr",
              text: "Saved Vibe session could not be resumed; retrying with a fresh session.",
            });
            runAttempt(executable, null);
            return;
          }
          control.finish();
          handlers.onError(
            result.userMessage || "Mistral Vibe execution failed.",
            result.stderr.trim() || undefined,
          );
          return;
        }

        const finalText = parser.finalText() || sanitizeTerminalOutput(result.stdout).trim();
        if (!parser.assistantText() && finalText) {
          handlers.onAssistantDelta?.(finalText);
        }
        const sessionId =
          resumeSessionId ??
          (await findSessionImpl({ workspaceRoot, sinceMs: spawnedAt, env }).catch(() => null));
        if (cancelled) {
          control.finish();
          return;
        }
        if (sessionId)
          handlers.onNativeSession?.({
            source: "vibe",
            sessionId,
            modelId: request.route.modelId,
            throughMessageCount: (request.conversationHistory?.length ?? 0) + 2,
            transcriptHash: createHash("sha256")
              .update(
                JSON.stringify(
                  [
                    ...(request.conversationHistory ?? []),
                    { role: "user", content: request.prompt },
                    { role: "assistant", content: finalText },
                  ].map(({ role, content }) => ({ role, content })),
                ),
              )
              .digest("hex"),
          });
        control.finish();
        handlers.onFinalAnswerObserved?.(finalText);
        handlers.onResponse(finalText);
      })
      .catch((error) => {
        control.finish();
        if (cancelled) return;
        handlers.onError(errorMessage(error, "Mistral Vibe execution failed."));
      });
  };

  void (async () => {
    const executable = await resolveExecutable(workspaceRoot);
    if (cancelled) {
      control.finish();
      return;
    }
    if (!executable) {
      control.finish();
      handlers.onError(MISTRAL_VIBE_MISSING_MESSAGE);
      return;
    }
    const reference = [...(request.nativeSessions ?? [])]
      .reverse()
      .find((session) => session.source === "vibe");
    const historyHash = createHash("sha256")
      .update(
        JSON.stringify(
          (request.conversationHistory ?? []).map(({ role, content }) => ({ role, content })),
        ),
      )
      .digest("hex");
    const compatible =
      reference?.modelId === request.route.modelId &&
      reference.throughMessageCount === (request.conversationHistory?.length ?? 0) &&
      reference.transcriptHash === historyHash;
    if (reference && !compatible)
      handlers.onProgress?.({
        id: "vibe-recovery",
        source: "transcript",
        text: "Saved Vibe state does not match this chat and model; recovering its transcript into a fresh session.",
      });
    runAttempt(executable, compatible ? reference.sessionId : null);
  })().catch((error) => {
    control.finish();
    if (!cancelled) handlers.onError(errorMessage(error, "Mistral Vibe launch failed."));
  });

  return () => {
    cancelled = true;
    currentCancel?.();
    control.finish();
  };
}

export async function validateMistralVibeRoute(
  options: { cwd: string; resolveExecutable?: (cwd: string) => Promise<string | null> } = {
    cwd: process.cwd(),
  },
): Promise<ProviderRouteValidationResult> {
  const resolveExecutable =
    options.resolveExecutable ?? ((cwd: string) => resolveVibeExecutable({ cwd }));
  const executable = await resolveExecutable(options.cwd);
  if (!executable) {
    return {
      status: "not-configured",
      providerId: "mistral",
      backendKind: "unavailable",
      message: MISTRAL_VIBE_MISSING_MESSAGE,
      diagnostics: { resolvedCommand: null },
    };
  }
  const detected = detectVibeActiveModel({ cwd: options.cwd });
  return {
    status: "ready",
    providerId: "mistral",
    backendKind: "mistral-vibe-cli-auth",
    message: "Mistral Vibe CLI is available.",
    diagnostics: {
      resolvedCommand: executable,
      selectedModel: detected.modelId,
      modelSource: detected.source,
    },
  };
}

export const mistralVibeRuntime: ProviderRuntime = {
  providerId: "mistral",
  label: "Mistral Vibe CLI",
  modelPickerLabel: "Mistral Vibe",
  backendKind: "mistral-vibe-cli-auth",
  routeAvailable: true,
  routeStatus: "Uses the Mistral Vibe CLI (vibe -p) with your existing vibe authentication.",
  routeSetupMessage: MISTRAL_VIBE_MISSING_MESSAGE,
  launchAvailable: true,
  validateRoute: async ({ workspaceRoot }) => validateMistralVibeRoute({ cwd: workspaceRoot }),
  discoverModels: () => discoverMistralVibeModels(),
  refreshModels: async ({ cwd, providerConfig, signal }) => {
    const executable = await resolveVibeExecutable({ cwd });
    if (!executable) {
      return {
        status: "not-configured",
        providerId: "mistral",
        backendKind: "unavailable",
        models: [],
        message: MISTRAL_VIBE_MISSING_MESSAGE,
      };
    }
    const discovery = await fetchMistralModels({ cwd, providerConfig, signal });
    if (discovery.freshness === "verified" && !signal?.aborted) liveMistralCatalog = discovery;
    return discovery;
  },
  run: (request, handlers) => runMistralVibe(request, handlers),
};
