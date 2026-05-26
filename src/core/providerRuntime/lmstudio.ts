export interface LmStudioModelInfo {
  id: string;
  object?: string;
  type?: string;
  publisher?: string;
  arch?: string;
  compatibility_type?: string;
  quantization?: string;
  state?: string;
  max_context_length?: number;
  loaded_context_length?: number;
  capabilities?: string[];
}

export interface LmStudioModelList {
  data: LmStudioModelInfo[];
  object?: string;
}

export function deriveLmStudioApiRoot(baseUrl: string): string | null {
  try {
    return `${new URL(baseUrl).origin}/api/v0`;
  } catch {
    return null;
  }
}

export async function fetchLmStudioModelInfo(options: {
  apiRoot: string;
  modelId: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<LmStudioModelInfo | null> {
  const { apiRoot, modelId, signal } = options;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  try {
    const url = `${apiRoot}/models/${encodeURIComponent(modelId)}`;
    const response = await fetchImpl(url, { method: "GET", signal });
    if (!response.ok) return null;
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return null;
    }
    if (
      typeof parsed !== "object"
      || parsed === null
      || typeof (parsed as { id?: unknown }).id !== "string"
    ) {
      return null;
    }
    return parsed as LmStudioModelInfo;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseModelInfo(value: unknown): LmStudioModelInfo | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
    return null;
  }
  return {
    id: value.id,
    ...(typeof value.object === "string" ? { object: value.object } : {}),
    ...(typeof value.type === "string" ? { type: value.type } : {}),
    ...(typeof value.publisher === "string" ? { publisher: value.publisher } : {}),
    ...(typeof value.arch === "string" ? { arch: value.arch } : {}),
    ...(typeof value.compatibility_type === "string" ? { compatibility_type: value.compatibility_type } : {}),
    ...(typeof value.quantization === "string" ? { quantization: value.quantization } : {}),
    ...(typeof value.state === "string" ? { state: value.state } : {}),
    ...(typeof value.max_context_length === "number" ? { max_context_length: value.max_context_length } : {}),
    ...(typeof value.loaded_context_length === "number" ? { loaded_context_length: value.loaded_context_length } : {}),
    ...(Array.isArray(value.capabilities)
      ? { capabilities: value.capabilities.filter((item): item is string => typeof item === "string") }
      : {}),
  };
}

export function parseLmStudioModelsResponse(body: unknown): LmStudioModelList | null {
  if (!isRecord(body) || !Array.isArray(body.data)) {
    return null;
  }
  return {
    object: typeof body.object === "string" ? body.object : undefined,
    data: body.data
      .map(parseModelInfo)
      .filter((model): model is LmStudioModelInfo => model !== null),
  };
}

export async function fetchLmStudioModels(options: {
  apiRoot: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<LmStudioModelList | null> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  try {
    const response = await fetchImpl(`${options.apiRoot}/models`, {
      method: "GET",
      signal: options.signal,
    });
    if (!response.ok) return null;
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return null;
    }
    return parseLmStudioModelsResponse(parsed);
  } catch {
    return null;
  }
}
