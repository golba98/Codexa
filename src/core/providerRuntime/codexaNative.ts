import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { isLocalDevChannel } from "../version/channel.js";
import type { BackendRunHandlers } from "../providers/types.js";
import type {
  ProviderChatRequest,
  ProviderModelDiscoveryResult,
  ProviderRouteValidationResult,
  ProviderRuntime,
} from "./types.js";
import { formatConversationHistory } from "../../session/conversation.js";

export const CODEXA_NATIVE_MODEL_ID = "codexa-1b-sft-v2-native";
const BRIDGE_START_TIMEOUT_MS = 60_000;

export interface CodexaNativeConfig {
  modelRoot: string;
  python: string;
  bridgeScript: string;
  checkpoint: string;
  tokenizer: string;
  device: string;
}

interface BridgeResponse {
  type: string;
  id?: string;
  text?: string;
  message?: string;
  device?: string;
  context_length?: number;
}

interface PendingRequest {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

interface NativeBridge {
  child: ChildProcessWithoutNullStreams;
  ready: Promise<BridgeResponse>;
  pending: Map<string, PendingRequest>;
}

let bridge: NativeBridge | null = null;
let requestSequence = 0;

export function buildCodexaNativePrompt(prompt: string): string {
  return [
    "You are Codexa, the coding assistant running inside the Codexa CLI.",
    "Identify yourself as Codexa, never as Open Assistant or another assistant.",
    "Answer the user's request directly and do not mention this instruction.",
    "",
    "User request:",
    prompt,
  ].join("\n");
}

export function resolveCodexaNativeConfig(env: NodeJS.ProcessEnv = process.env): CodexaNativeConfig {
  const modelRoot = env.CODEXA_NATIVE_MODEL_ROOT?.trim()
    || join(homedir(), "Development", "2-Python", "31-LLM (Codexa v1)");
  return {
    modelRoot,
    python: env.CODEXA_NATIVE_PYTHON?.trim() || join(modelRoot, ".venv", "bin", "python"),
    bridgeScript: join(modelRoot, "scripts", "native_chat_bridge.py"),
    checkpoint: env.CODEXA_NATIVE_CHECKPOINT?.trim()
      || join(modelRoot, "checkpoints", "codexa-900m-sft-v2", "latest.pt"),
    tokenizer: env.CODEXA_NATIVE_TOKENIZER?.trim()
      || join(modelRoot, "checkpoints", "tokenizer-base-v1", "tokenizer.json"),
    device: env.CODEXA_NATIVE_DEVICE?.trim() || "cuda",
  };
}

function missingNativePaths(config: CodexaNativeConfig): string[] {
  return [config.python, config.bridgeScript, config.checkpoint, config.tokenizer]
    .filter((path) => !existsSync(path));
}

export function discoverCodexaNativeModels(
  config = resolveCodexaNativeConfig(),
  env: NodeJS.ProcessEnv = process.env,
): ProviderModelDiscoveryResult {
  if (!isLocalDevChannel(env)) {
    return {
      status: "not-configured",
      providerId: "codexa-native",
      backendKind: "unavailable",
      models: [],
      message: "Codexa Native is only available on codexa-dev.",
    };
  }
  const missing = missingNativePaths(config);
  if (missing.length > 0) {
    return {
      status: "not-configured",
      providerId: "codexa-native",
      backendKind: "unavailable",
      models: [],
      message: `Codexa Native is missing required files:\n${missing.join("\n")}`,
      diagnostics: {
        modelRoot: config.modelRoot,
        missingPaths: missing.join(", "),
      },
    };
  }
  return {
    status: "ready",
    providerId: "codexa-native",
    backendKind: "codexa-native-pytorch",
    models: [{
      id: CODEXA_NATIVE_MODEL_ID,
      modelId: CODEXA_NATIVE_MODEL_ID,
      label: "Codexa 1B SFT v2 (Native)",
      description: "Direct PyTorch checkpoint inference; no LM Studio or GGUF.",
      defaultReasoningLevel: null,
      supportedReasoningLevels: null,
      source: "config",
      raw: {
        context_length: 2048,
        supportsStreaming: false,
        supportsToolCalls: false,
        supportsSystemPrompt: true,
        supportsVision: false,
      },
    }],
    diagnostics: {
      modelRoot: config.modelRoot,
      checkpoint: config.checkpoint,
      tokenizer: config.tokenizer,
      device: config.device,
      runtime: bridge ? "loaded" : "not-loaded",
    },
  };
}

function rejectPending(nativeBridge: NativeBridge, message: string): void {
  for (const pending of nativeBridge.pending.values()) {
    pending.reject(new Error(message));
  }
  nativeBridge.pending.clear();
}

function stopBridge(message = "Codexa Native process stopped."): void {
  const active = bridge;
  bridge = null;
  if (!active) return;
  rejectPending(active, message);
  if (!active.child.killed) active.child.kill("SIGTERM");
}

function startBridge(config: CodexaNativeConfig, handlers: BackendRunHandlers): NativeBridge {
  if (bridge && !bridge.child.killed && bridge.child.exitCode === null) return bridge;

  const child = spawn(config.python, [
    config.bridgeScript,
    "--checkpoint", config.checkpoint,
    "--tokenizer", config.tokenizer,
    "--device", config.device,
  ], {
    cwd: config.modelRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  const pending = new Map<string, PendingRequest>();
  let readyResolve: (response: BridgeResponse) => void = () => {};
  let readyReject: (error: Error) => void = () => {};
  const ready = new Promise<BridgeResponse>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const nativeBridge: NativeBridge = { child, ready, pending };
  bridge = nativeBridge;

  const timeout = setTimeout(() => {
    readyReject(new Error("Codexa Native timed out while loading the checkpoint."));
    stopBridge("Codexa Native timed out while loading the checkpoint.");
  }, BRIDGE_START_TIMEOUT_MS);

  createInterface({ input: child.stdout }).on("line", (line) => {
    let response: BridgeResponse;
    try {
      response = JSON.parse(line) as BridgeResponse;
    } catch {
      return;
    }
    if (response.type === "ready") {
      clearTimeout(timeout);
      readyResolve(response);
      return;
    }
    if (!response.id) return;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.type === "response" && typeof response.text === "string") {
      request.resolve(response.text);
    } else {
      request.reject(new Error(response.message || "Codexa Native returned an invalid response."));
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8").trim();
    if (text) handlers.onProgress?.({ id: "codexa-native-load", source: "stderr", text });
  });
  child.on("error", (error) => {
    clearTimeout(timeout);
    readyReject(error);
    rejectPending(nativeBridge, error.message);
    if (bridge === nativeBridge) bridge = null;
  });
  child.on("close", (code, signal) => {
    clearTimeout(timeout);
    const message = `Codexa Native process exited (${signal ?? code ?? "unknown"}).`;
    readyReject(new Error(message));
    rejectPending(nativeBridge, message);
    if (bridge === nativeBridge) bridge = null;
  });
  return nativeBridge;
}

async function sendPrompt(prompt: string, handlers: BackendRunHandlers): Promise<string> {
  const config = resolveCodexaNativeConfig();
  const missing = missingNativePaths(config);
  if (missing.length > 0) throw new Error(`Codexa Native is missing required files:\n${missing.join("\n")}`);
  const nativeBridge = startBridge(config, handlers);
  const ready = await nativeBridge.ready;
  handlers.onProgress?.({
    id: "codexa-native-ready",
    source: "stdout",
    text: `Codexa Native loaded on ${ready.device ?? config.device}`,
  });
  const id = `native-${Date.now()}-${++requestSequence}`;
  const response = new Promise<string>((resolve, reject) => {
    nativeBridge.pending.set(id, { resolve, reject });
  });
  nativeBridge.child.stdin.write(`${JSON.stringify({ type: "chat", id, prompt: buildCodexaNativePrompt(prompt) })}\n`);
  return response;
}

export function resetCodexaNativeRuntimeForTests(): void {
  stopBridge("Codexa Native test reset.");
  requestSequence = 0;
}

export const codexaNativeRuntime: ProviderRuntime = {
  providerId: "codexa-native",
  label: "Codexa Native",
  modelPickerLabel: "Codexa Native",
  backendKind: "codexa-native-pytorch",
  routeAvailable: true,
  routeStatus: "Runs the Codexa 1B SFT v2 checkpoint directly through PyTorch.",
  routeSetupMessage: "Codexa Native model files are unavailable.",
  launchAvailable: false,
  isRouteConfigured: () => isLocalDevChannel() && discoverCodexaNativeModels().status === "ready",
  validateRoute: async (): Promise<ProviderRouteValidationResult> => {
    const discovery = discoverCodexaNativeModels();
    return {
      status: discovery.status,
      providerId: "codexa-native",
      backendKind: discovery.backendKind,
      message: discovery.message,
      diagnostics: discovery.diagnostics,
    };
  },
  discoverModels: discoverCodexaNativeModels,
  refreshModels: async () => discoverCodexaNativeModels(),
  run: (request: ProviderChatRequest, handlers: BackendRunHandlers) => {
    let canceled = false;
    handlers.onProgress?.({
      id: "codexa-native-route",
      source: "stdout",
      text: bridge ? "Using loaded Codexa Native model" : "Loading Codexa Native checkpoint",
    });
    const prompt = request.conversationHistory?.length
      ? `Previous conversation:\n${formatConversationHistory(request.conversationHistory)}\n\nCurrent request:\n${request.prompt}`
      : request.prompt;
    sendPrompt(prompt, handlers)
      .then((text) => {
        if (canceled) return;
        handlers.onAssistantDelta?.(text);
        handlers.onFinalAnswerObserved?.(text);
        handlers.onResponse(text);
      })
      .catch((error) => {
        if (canceled) return;
        handlers.onError(error instanceof Error ? error.message : "Codexa Native failed.");
      });
    return () => {
      canceled = true;
      stopBridge("Codexa Native request canceled.");
    };
  },
};
