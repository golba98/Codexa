import { buildSpawnSpec, resolveGeminiExecutable } from "../executables/executableResolver.js";
import { runCommand } from "../process/commandRunner.js";
import type { ProviderWorkspaceOverride } from "../providerLauncher/types.js";
import { isRecord } from "../shared/values.js";
import { formatGeminiModelLabel } from "./models.js";
import type { ProviderModel, ProviderModelDiscoveryResult } from "./types.js";

export function parseGeminiModels(body: unknown, cli = false): ProviderModel[] {
  const entries = isRecord(body) ? body[cli ? "availableModels" : "models"] : null;
  if (!Array.isArray(entries)) throw new Error("Malformed Gemini model inventory.");
  const models = new Map<string, ProviderModel>();
  for (const item of entries) {
    if (!isRecord(item)) continue;
    const id = cli ? item.modelId : item.name;
    if (typeof id !== "string" || !id.trim()) continue;
    if (
      !cli &&
      (!Array.isArray(item.supportedGenerationMethods) ||
        !item.supportedGenerationMethods.includes("generateContent"))
    )
      continue;
    // Documented controls apply only to discovered native IDs, never to the inventory itself.
    const nativeId = id.replace(/^models\//, "");
    const documentedLevels: Record<string, [string[], string]> = {
      "gemini-3.8-flash": [["low", "medium", "high"], "medium"],
      "gemini-3.7-flash": [["low", "medium", "high"], "medium"],
      "gemini-3.6-flash": [["minimal", "low", "medium", "high"], "medium"],
      "gemini-3.5-flash": [["minimal", "low", "medium", "high"], "medium"],
      "gemini-3.1-pro": [["low", "medium", "high"], "high"],
      "gemini-3.1-pro-preview": [["low", "medium", "high"], "high"],
      "gemini-3.5-flash-lite": [["minimal", "low", "medium", "high"], "minimal"],
      "gemini-3.1-flash-lite": [["minimal", "low", "medium", "high"], "minimal"],
      "gemini-3.1-flash-lite-image": [["minimal", "high"], "minimal"],
      "gemini-3-flash-preview": [["minimal", "low", "medium", "high"], "high"],
    };
    const documented = item.thinking === false ? undefined : documentedLevels[nativeId];
    const levels = documented
      ? documented[0].map((id) => ({
          id,
          label: id.charAt(0).toUpperCase() + id.slice(1),
          description: null,
        }))
      : null;
    const budget =
      item.thinking === false
        ? undefined
        : /^gemini-2\.5-(pro|flash|flash-lite)$/.exec(nativeId)?.[1];
    const defaultLevel =
      documented?.[1] ?? (budget === "flash-lite" ? "budget:0" : budget ? "auto" : null);
    models.set(id, {
      id,
      modelId: id,
      providerId: "google",
      deployment: "remote",
      available: true,
      label: formatGeminiModelLabel(
        id,
        typeof item.displayName === "string"
          ? item.displayName
          : typeof item.name === "string"
            ? item.name
            : undefined,
      ),
      description: null,
      source: "discovered",
      version: typeof item.version === "string" ? item.version : undefined,
      contextWindow:
        typeof item.inputTokenLimit === "number" && item.inputTokenLimit > 0
          ? item.inputTokenLimit
          : null,
      capabilities: {
        chat: true,
        tools: null,
        vision: null,
        reasoning: typeof item.thinking === "boolean" ? item.thinking : null,
      },
      defaultReasoningLevel: defaultLevel,
      supportedReasoningLevels: levels,
      reasoningControl: levels
        ? {
            kind: "levels",
            levels,
            default: documented?.[1] ?? levels[0]?.id ?? "",
            transport: "parameter",
          }
        : budget
          ? {
              kind: "budget",
              min: budget === "pro" ? 128 : budget === "flash-lite" ? 512 : 1,
              max: budget === "pro" ? 32768 : 24576,
              default: budget === "flash-lite" ? 0 : -1,
              auto: true,
              canDisable: budget !== "pro",
            }
          : { kind: item.thinking === false ? "unsupported" : "unknown" },
      raw: { ...item },
    });
  }
  const labels = new Map<string, number>();
  for (const model of models.values()) labels.set(model.label, (labels.get(model.label) ?? 0) + 1);
  return [...models.values()].map((model) =>
    (labels.get(model.label) ?? 0) > 1
      ? { ...model, label: `${model.label} (${model.modelId})` }
      : model,
  );
}

export async function discoverGeminiModels(options: {
  cwd: string;
  providerConfig?: ProviderWorkspaceOverride;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  runCommandImpl?: typeof runCommand;
}): Promise<ProviderModelDiscoveryResult> {
  const key =
    options.providerConfig?.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const base =
    options.providerConfig?.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
  const result = {
    providerId: "google" as const,
    backendKind: key ? ("gemini-api-key" as const) : ("gemini-cli-auth" as const),
  };
  try {
    if (key) {
      const models: ProviderModel[] = [];
      let token = "";
      const tokens = new Set<string>();
      do {
        const url = new URL(`${base.replace(/\/+$/, "").replace(/\/models$/, "")}/models`);
        url.searchParams.set("pageSize", "100");
        if (token) url.searchParams.set("pageToken", token);
        const response = await (options.fetchImpl ?? fetch)(url, {
          headers: { "x-goog-api-key": key },
          signal: options.signal ?? AbortSignal.timeout(15_000),
        });
        if (!response.ok)
          return {
            ...result,
            status: "not-configured",
            models: [],
            freshness: "unverified",
            refreshState:
              response.status === 401 || response.status === 403 ? "auth-required" : "failed",
            message: `Gemini discovery failed (HTTP ${response.status}).`,
          };
        const body: unknown = await response.json();
        models.push(...parseGeminiModels(body));
        token = isRecord(body) && typeof body.nextPageToken === "string" ? body.nextPageToken : "";
        if (token && tokens.has(token)) throw new Error("Repeated Gemini page token.");
        tokens.add(token);
      } while (token);
      return { ...result, status: "ready", models, freshness: "verified" };
    }
    const executable = await resolveGeminiExecutable({
      cwd: options.cwd,
      configuredPath: options.providerConfig?.geminiCommandPath,
    });
    const models = await new Promise<ProviderModel[]>((resolve, reject) => {
      let buffer = "";
      let settled = false;
      let accessDenied = false;
      const finish = (models?: ProviderModel[]) => {
        if (settled) return;
        settled = true;
        models
          ? resolve(models)
          : reject(
              new Error(
                accessDenied ? "Gemini account access denied." : "Gemini ACP discovery failed.",
              ),
            );
        runner.cancel();
      };
      const runner = (options.runCommandImpl ?? runCommand)(
        {
          ...buildSpawnSpec(executable, ["--acp"], process.platform),
          cwd: options.cwd,
          timeoutMs: 15_000,
          stdinData: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {} } })}\n`,
          keepStdinOpen: true,
        },
        {
          onStdout: (chunk) => {
            buffer += chunk;
            if (buffer.length > 1024 * 1024) {
              finish();
              return;
            }
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              try {
                const message = JSON.parse(line);
                if (message.error) {
                  accessDenied = /auth|access|supported|eligible|permission|credential/i.test(
                    String(message.error.message),
                  );
                  finish();
                  return;
                }
                if (message.id === 1)
                  runner.child.stdin?.write(
                    `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: options.cwd, mcpServers: [] } })}\n`,
                  );
                if (message.id === 2) finish(parseGeminiModels(message.result.models, true));
              } catch {
                /* Diagnostics and incomplete lines are not catalog entries. */
              }
            }
          },
        },
      );
      const cancel = () => finish();
      options.signal?.addEventListener("abort", cancel, { once: true });
      if (options.signal?.aborted) cancel();
      void runner.result
        .then(() => finish())
        .finally(() => options.signal?.removeEventListener("abort", cancel));
    });
    return { ...result, status: "ready", models, freshness: "verified" };
  } catch (error) {
    const denied = error instanceof Error && error.message === "Gemini account access denied.";
    return {
      ...result,
      status: "not-configured",
      models: [],
      freshness: "unverified",
      refreshState: denied ? "auth-required" : "failed",
      message: denied
        ? "Gemini account access was denied by the provider; check CLI eligibility or configure an API key."
        : "Gemini discovery failed; check CLI authentication or API configuration.",
    };
  }
}
