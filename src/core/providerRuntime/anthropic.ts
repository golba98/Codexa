import { runCommand } from "../process/CommandRunner.js";
import type { CommandResult } from "../process/CommandRunner.js";
import { sanitizeTerminalOutput } from "../terminalSanitize.js";
import type { BackendRunHandlers } from "../providers/types.js";
import { ANTHROPIC_FALLBACK_MODELS } from "./models.js";
import type { ProviderBackendKind, ProviderChatRequest, ProviderModel, ProviderModelDiscoveryResult, ProviderRouteValidationResult, ProviderRuntime } from "./types.js";
import { resolveClaudeExecutable, buildClaudeSpawnSpec, resetClaudeExecutableCacheForTests } from "../claudeExecutable.js";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MAX_TOKENS = 1024;
const ANTHROPIC_TIMEOUT_MS = 120_000;
const ANTHROPIC_AUTH_CHECK_TIMEOUT_MS = 10_000;
const ANTHROPIC_ROUTE_VALIDATION_TIMEOUT_MS = 15_000;
export const ANTHROPIC_ROUTE_SETUP_MESSAGE = "Anthropic/Claude is not configured for in-Codexa routing.\nSign in with Claude Code or set ANTHROPIC_API_KEY.";

type CommandRunner = typeof runCommand;

let claudeCodeValidated = false;
let resolvedClaudeExecutable: string = "claude";
let discoveredAnthropicModels: readonly ProviderModel[] | null = null;

function getAnthropicApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY?.trim() || null;
}

export function isAnthropicRouteConfigured(): boolean {
  return getAnthropicApiKey() !== null || claudeCodeValidated;
}

export function resetAnthropicRouteValidationCacheForTests(): void {
  claudeCodeValidated = false;
  resolvedClaudeExecutable = "claude";
  discoveredAnthropicModels = null;
  resetClaudeExecutableCacheForTests();
}

// ---------------------------------------------------------------------------
// Auth status JSON parsing
// ---------------------------------------------------------------------------

interface ClaudeAuthStatusJson {
  loggedIn: boolean;
  authMethod?: string;
  apiProvider?: string;
  subscriptionType?: string;
}

export function parseClaudeAuthStatus(stdout: string): ClaudeAuthStatusJson | null {
  try {
    const parsed = JSON.parse(stdout.trim()) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    return {
      loggedIn: obj["loggedIn"] === true,
      authMethod: typeof obj["authMethod"] === "string" ? obj["authMethod"] : undefined,
      apiProvider: typeof obj["apiProvider"] === "string" ? obj["apiProvider"] : undefined,
      subscriptionType: typeof obj["subscriptionType"] === "string" ? obj["subscriptionType"] : undefined,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Environment capture
// ---------------------------------------------------------------------------

async function captureClaudeEnvironment(
  executable: string,
  cwd: string,
  runCommandImpl: CommandRunner,
): Promise<{ path: string; version: string | null }> {
  try {
    const versionRunner = runCommandImpl({
      executable,
      args: ["--version"],
      cwd,
      timeoutMs: 5000,
    });
    const versionResult = await versionRunner.result;
    return {
      path: executable,
      version: versionResult.status === "completed" && versionResult.exitCode === 0
        ? versionResult.stdout.trim().split(/[\r\n]+/)[0] ?? null
        : null,
    };
  } catch {
    return { path: executable, version: null };
  }
}

// ---------------------------------------------------------------------------
// Model discovery
// ---------------------------------------------------------------------------

function buildAnthropicModelsFromVersion(version: string | null): readonly ProviderModel[] {
  const source: "discovered" | "fallback" = version !== null ? "discovered" : "fallback";
  const versionNote = version ? `Claude Code ${version}` : "Claude Code CLI";
  return [
    {
      id: "opus",
      modelId: "opus",
      label: "Opus 4.7",
      description: `${versionNote} · Claude Opus 4.7`,
      defaultReasoningLevel: "high",
      supportedReasoningLevels: null,
      source,
    },
    {
      id: "sonnet",
      modelId: "sonnet",
      label: "Sonnet 4.6",
      description: `${versionNote} · Claude Sonnet 4.6`,
      defaultReasoningLevel: "high",
      supportedReasoningLevels: null,
      source,
    },
    {
      id: "haiku",
      modelId: "haiku",
      label: "Haiku 4.5",
      description: `${versionNote} · Claude Haiku 4.5`,
      defaultReasoningLevel: "medium",
      supportedReasoningLevels: null,
      source,
    },
  ];
}

// ---------------------------------------------------------------------------
// Model / reasoning / permission-mode mapping
// ---------------------------------------------------------------------------

// Claude Code CLI accepts both short aliases ("sonnet", "opus", "haiku") and
// full versioned IDs ("claude-sonnet-4-20250514"). Pass through unchanged.
export function mapModelIdToClaudeArg(modelId: string): string {
  return modelId;
}

export function mapReasoningToEffort(reasoning: string | null | undefined): string | null {
  if (reasoning === "low" || reasoning === "medium" || reasoning === "high") return reasoning;
  return null;
}

function buildClaudeCodeBaseArgs(request: ProviderChatRequest): string[] {
  const effort = mapReasoningToEffort(request.route.reasoning ?? null);
  return [
    "--model", mapModelIdToClaudeArg(request.route.modelId),
    ...(effort ? ["--effort", effort] : []),
    "--permission-mode", "default",
    request.prompt,
  ];
}

export function ensureClaudeStreamJsonVerbose(args: string[]): string[] {
  const outputFormatIndex = args.indexOf("--output-format");
  const usesStreamJson = outputFormatIndex >= 0 && args[outputFormatIndex + 1] === "stream-json";
  const usesPrint = args.includes("-p") || args.includes("--print");
  if (!usesStreamJson || !usesPrint || args.includes("--verbose")) return args;

  const printIndex = args.findIndex((arg) => arg === "-p" || arg === "--print");
  const next = [...args];
  next.splice(printIndex + 1, 0, "--verbose");
  return next;
}

export function buildClaudeCodeArgs(request: ProviderChatRequest): string[] {
  return ensureClaudeStreamJsonVerbose([
    "-p",
    "--output-format", "stream-json",
    "--include-partial-messages",
    ...buildClaudeCodeBaseArgs(request),
  ]);
}

export function buildClaudeCodePlainTextArgs(request: ProviderChatRequest): string[] {
  return [
    "-p",
    ...buildClaudeCodeBaseArgs(request),
  ];
}

// ---------------------------------------------------------------------------
// Stream-JSON parsing
// ---------------------------------------------------------------------------

interface StreamJsonAssistantEvent {
  type: "assistant";
  message: {
    content?: Array<{ type?: string; text?: string; partial?: boolean }>;
  };
}

/**
 * Parses one stdout line from `claude -p --output-format stream-json`.
 * Returns:
 *   string  — extracted assistant text delta
 *   null    — valid JSON but no text to emit (tool event, system event, etc.)
 *   false   — parse error; caller should fall back to plain-text mode
 */
export function tryParseStreamJsonDelta(line: string): string | null | false {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const event = parsed as Record<string, unknown>;
  if (event["type"] !== "assistant") return null;
  const msg = event["message"];
  if (typeof msg !== "object" || msg === null) return null;
  const content = (msg as StreamJsonAssistantEvent["message"]).content;
  if (!Array.isArray(content)) return null;
  const text = content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("");
  return text || null;
}

// ---------------------------------------------------------------------------
// Anthropic Messages API
// ---------------------------------------------------------------------------

async function runAnthropicApi(request: ProviderChatRequest): Promise<string> {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    throw new Error(ANTHROPIC_ROUTE_SETUP_MESSAGE);
  }

  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: request.route.modelId,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      ...(request.projectInstructions?.content ? { system: request.projectInstructions.content } : {}),
      messages: [
        {
          role: "user",
          content: request.prompt,
        },
      ],
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Anthropic API request failed (${response.status}): ${sanitizeTerminalOutput(body).slice(0, 500)}`);
  }

  const parsed = JSON.parse(body) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = parsed.content
    ?.filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("Anthropic API returned no assistant text.");
  }

  return text;
}

// ---------------------------------------------------------------------------
// Claude Code CLI execution (streaming)
// ---------------------------------------------------------------------------

function isClaudeStreamJsonRequiresVerboseError(result: CommandResult): boolean {
  const combined = `${result.userMessage}\n${result.stderr}\n${result.stdout}`;
  return /stream-json requires --verbose/i.test(combined);
}

function formatClaudeCommandDiagnostic(
  executable: string,
  args: string[],
  prompt: string,
): string {
  const safeArgs = args.map((arg) => arg === prompt ? `<prompt redacted: ${prompt.length} chars>` : arg);
  return `Claude Code command args: ${JSON.stringify([executable, ...safeArgs])}`;
}

export function runClaudeCodeWithRunner(
  request: ProviderChatRequest,
  handlers: BackendRunHandlers,
  runCommandImpl: CommandRunner = runCommand,
  executable: string = resolvedClaudeExecutable,
): () => void {
  let currentCancel: (() => void) | null = null;
  let canceled = false;

  const runAttempt = (mode: "stream-json" | "plain-text") => {
    const args = mode === "stream-json"
      ? buildClaudeCodeArgs(request)
      : buildClaudeCodePlainTextArgs(request);
    const spawnSpec = buildClaudeSpawnSpec(executable, args);

    let accumulatedText = "";
    let streamingFailed = false;
    let lineBuf = "";

    const runner = runCommandImpl(
      {
        executable: spawnSpec.executable,
        args: spawnSpec.args,
        cwd: request.workspaceRoot,
        timeoutMs: ANTHROPIC_TIMEOUT_MS,
      },
      {
        onStdout: (chunk) => {
          if (mode !== "stream-json" || streamingFailed) return;
          lineBuf += chunk;
          const lines = lineBuf.split("\n");
          lineBuf = lines.pop() ?? "";
          for (const line of lines) {
            const delta = tryParseStreamJsonDelta(line);
            if (delta === false) {
              streamingFailed = true;
              return;
            }
            if (delta) {
              accumulatedText += delta;
              handlers.onAssistantDelta?.(delta);
            }
          }
        },
      },
    );

    currentCancel = runner.cancel;
    runner.result.then((result) => {
      if (canceled || result.status === "canceled") return;
      if (result.status !== "completed" || result.exitCode !== 0) {
        const diagnostic = formatClaudeCommandDiagnostic(spawnSpec.executable, spawnSpec.args, request.prompt);
        if (mode === "stream-json" && isClaudeStreamJsonRequiresVerboseError(result)) {
          handlers.onProgress?.({
            id: "anthropic-claude-command-retry",
            source: "stderr",
            text: `${diagnostic}\nClaude Code rejected stream-json args; retrying once with plain text output.`,
          });
          runAttempt("plain-text");
          return;
        }

        const message = result.userMessage || result.stderr || "Claude Code execution failed.";
        handlers.onError(message, diagnostic);
        return;
      }
      let finalText: string;
      if (mode === "stream-json" && !streamingFailed && accumulatedText !== "") {
        finalText = accumulatedText;
      } else {
        finalText = sanitizeTerminalOutput(result.stdout).trim();
        if (finalText && (mode !== "stream-json" || accumulatedText === "")) {
          handlers.onAssistantDelta?.(finalText);
        }
      }
      handlers.onFinalAnswerObserved?.(finalText);
      handlers.onResponse(finalText);
    }).catch((error) => {
      if (canceled) return;
      const message = error instanceof Error ? error.message : "Claude Code execution failed.";
      handlers.onError(message);
    });
  };

  runAttempt("stream-json");

  return () => {
    canceled = true;
    currentCancel?.();
  };
}

function runClaudeCode(
  request: ProviderChatRequest,
  handlers: BackendRunHandlers,
): () => void {
  return runClaudeCodeWithRunner(request, handlers);
}

// ---------------------------------------------------------------------------
// Route validation
// ---------------------------------------------------------------------------

export async function validateAnthropicRoute(options: {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  runCommandImpl?: CommandRunner;
  timeoutMs?: number;
}): Promise<ProviderRouteValidationResult> {
  const runImpl = options.runCommandImpl ?? runCommand;

  // 1. Resolve the actual Claude executable (where.exe or CLAUDE_EXECUTABLE override)
  let executable: string;
  try {
    executable = await resolveClaudeExecutable({
      runCommandImpl: options.runCommandImpl,
      cwd: options.cwd,
    });
    resolvedClaudeExecutable = executable;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resolve Claude executable.";
    return {
      status: "not-configured",
      providerId: "anthropic",
      backendKind: "unavailable",
      message,
      diagnostics: { resolvedCommand: null },
    };
  }

  // 2. Capture version info in parallel with auth check
  const envInfoPromise = captureClaudeEnvironment(executable, options.cwd, runImpl);

  const authSpawnSpec = buildClaudeSpawnSpec(executable, ["auth", "status"]);
  const authRunner = runImpl({
    executable: authSpawnSpec.executable,
    args: authSpawnSpec.args,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? ANTHROPIC_AUTH_CHECK_TIMEOUT_MS,
  });
  const authResult = await authRunner.result;
  const envInfo = await envInfoPromise;

  // Populate model discovery cache from version info — runs regardless of auth result
  // so models are available even when auth is unconfigured.
  discoveredAnthropicModels = buildAnthropicModelsFromVersion(envInfo.version);

  const diagnostics: Record<string, string | number | boolean | null> = {
    resolvedCommand: executable,
    executablePath: envInfo.path,
    version: envInfo.version,
    authCommand: `${executable} auth status`,
    authStatus: authResult.exitCode,
    authCheckStatus: authResult.status,
    timeout: authResult.status === "timeout",
    stderrSummary: authResult.stderr.trim().slice(0, 200),
    modelSource: discoveredAnthropicModels[0]?.source ?? "fallback",
  };

  if (authResult.status === "completed" && authResult.exitCode === 0) {
    const authJson = parseClaudeAuthStatus(authResult.stdout);

    const extraDiag: Record<string, string | number | boolean | null> = authJson
      ? {
          loggedIn: authJson.loggedIn,
          authMethod: authJson.authMethod ?? null,
          apiProvider: authJson.apiProvider ?? null,
          subscriptionType: authJson.subscriptionType ?? null,
        }
      : { loggedIn: null, authJsonParsed: false };

    // JSON parsed but explicitly not logged in
    if (authJson !== null && !authJson.loggedIn) {
      claudeCodeValidated = false;
      return {
        status: "not-configured",
        providerId: "anthropic",
        backendKind: "unavailable",
        message: "Claude Code is not signed in. Run: claude auth login",
        diagnostics: { ...diagnostics, ...extraDiag },
      };
    }

    // loggedIn === true, or JSON parse failed (old CLI that doesn't output JSON — accept exit 0)
    claudeCodeValidated = true;
    const authMethodLabel = authJson?.authMethod ?? null;
    return {
      status: "ready",
      providerId: "anthropic",
      backendKind: "claude-code-auth",
      message: authMethodLabel
        ? `Claude Code authenticated (${authMethodLabel}).`
        : "Claude Code auth is configured.",
      diagnostics: { ...diagnostics, ...extraDiag },
    };
  }

  claudeCodeValidated = false;

  if (getAnthropicApiKey() !== null) {
    return {
      status: "ready",
      providerId: "anthropic",
      backendKind: "anthropic-api-key",
      message: "Anthropic API key is configured.",
      diagnostics,
    };
  }

  let errorMessage: string;
  if (authResult.status === "spawn_error" || authResult.errorCode === "ENOENT") {
    errorMessage = `\`${executable}\` command not found. Install Claude Code from https://claude.ai/code or set CLAUDE_EXECUTABLE to the full path.`;
  } else if (authResult.status === "timeout") {
    errorMessage = `Claude Code auth check timed out. Run: ${executable} auth status`;
  } else if (authResult.exitCode === 1) {
    errorMessage = `Claude Code is installed but not signed in. Run: ${executable} auth login`;
  } else {
    errorMessage = `Claude Code auth check failed. Run: ${executable} auth status`;
  }

  return {
    status: "not-configured",
    providerId: "anthropic",
    backendKind: "unavailable",
    message: errorMessage,
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

function getAnthropicRuntimeBackendKind(): ProviderBackendKind {
  return claudeCodeValidated ? "claude-code-auth" : getAnthropicApiKey() ? "anthropic-api-key" : "claude-code-auth";
}

function getActiveAnthropicModels(): readonly ProviderModel[] {
  return discoveredAnthropicModels ?? ANTHROPIC_FALLBACK_MODELS;
}

export const anthropicRuntime: ProviderRuntime = {
  providerId: "anthropic",
  label: "Anthropic/Claude",
  modelPickerLabel: "Claude",
  backendKind: "claude-code-auth",
  routeAvailable: true,
  routeStatus: "Routes through Claude Code CLI when authenticated (`claude auth status` exit 0), or via ANTHROPIC_API_KEY.",
  routeSetupMessage: ANTHROPIC_ROUTE_SETUP_MESSAGE,
  launchAvailable: true,
  isRouteConfigured: isAnthropicRouteConfigured,
  validateRoute: async ({ workspaceRoot }) => validateAnthropicRoute({
    cwd: workspaceRoot,
  }),
  discoverModels: (): ProviderModelDiscoveryResult => ({
    status: "ready",
    providerId: "anthropic",
    backendKind: getAnthropicRuntimeBackendKind(),
    models: getActiveAnthropicModels(),
  }),
  refreshModels: async ({ cwd }): Promise<ProviderModelDiscoveryResult> => {
    const envInfo = await captureClaudeEnvironment(resolvedClaudeExecutable, cwd, runCommand);
    discoveredAnthropicModels = buildAnthropicModelsFromVersion(envInfo.version);
    return {
      status: "ready",
      providerId: "anthropic",
      backendKind: getAnthropicRuntimeBackendKind(),
      models: discoveredAnthropicModels,
    };
  },
  run: (request, handlers: BackendRunHandlers) => {
    handlers.onProgress?.({
      id: "anthropic-route",
      source: "stdout",
      text: "Routing prompt through Anthropic/Claude inside Codexa...",
    });

    if (claudeCodeValidated) {
      return runClaudeCode(request, handlers);
    }

    if (getAnthropicApiKey()) {
      let cancelled = false;
      runAnthropicApi(request)
        .then((text) => {
          if (cancelled) return;
          handlers.onAssistantDelta?.(text);
          handlers.onFinalAnswerObserved?.(text);
          handlers.onResponse(text);
        })
        .catch((error) => {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : "Anthropic/Claude in-Codexa routing failed.";
          handlers.onError(message);
        });
      return () => { cancelled = true; };
    }

    return runClaudeCode(request, handlers);
  },
};
