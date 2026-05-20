export type AntigravityOutputClass =
  | "assistant_output"
  | "provider_protocol"
  | "provider_task_progress"
  | "provider_tool_stdout"
  | "provider_tool_stderr"
  | "provider_auth"
  | "provider_probe"
  | "provider_health_check"
  | "provider_status"
  | "provider_debug"
  | "provider_error"
  | "sensitive_auth_url"
  | "hidden_reasoning"
  | "unknown_internal";

export interface ClassifierState {
  insideTaskProgress: boolean;
  insideThought: boolean;
  insideStandardOutput: boolean;
  insideStandardError: boolean;
  promptToSuppress: string | null;
}

export function makeClassifierState(promptToSuppress?: string): ClassifierState {
  return {
    insideTaskProgress: false,
    insideThought: false,
    insideStandardOutput: false,
    insideStandardError: false,
    promptToSuppress: promptToSuppress?.trim() ?? null,
  };
}

const MODEL_PROBE_RE = /^MODEL=.+;\s*REASONING=(High|Medium|Low|Thinking|Unknown)/i;
const AUTH_URL_RE = /accounts\.google\.com|oauth2|authorization_code/i;
const PLEASE_VISIT_RE = /please visit\s+https?:\/\//i;
const BG_TASK_RE = /^Background task /i;
const STD_OUT_RE = /^Standard Output:/i;
const STD_ERR_RE = /^Standard Error:/i;
const AUTH_PHRASES = [
  "authentication required",
  "waiting for authentication",
  "paste the authorization code",
];

export function classifyLine(
  line: string,
  state: ClassifierState,
): { classification: AntigravityOutputClass; nextState: ClassifierState } {
  const trimmed = line.trim();
  let next = { ...state };

  // --- Block: task_progress ---
  if (trimmed === "<task_progress>") {
    next.insideTaskProgress = true;
    return { classification: "provider_task_progress", nextState: next };
  }
  if (trimmed === "</task_progress>") {
    next.insideTaskProgress = false;
    // Exit also closes any nested stdout/stderr sections
    next.insideStandardOutput = false;
    next.insideStandardError = false;
    return { classification: "provider_task_progress", nextState: next };
  }
  if (state.insideTaskProgress) {
    // Check for Standard Output/Error headers inside task_progress
    if (STD_OUT_RE.test(trimmed)) {
      next.insideStandardOutput = true;
      next.insideStandardError = false;
      return { classification: "provider_tool_stdout", nextState: next };
    }
    if (STD_ERR_RE.test(trimmed)) {
      next.insideStandardError = true;
      next.insideStandardOutput = false;
      return { classification: "provider_tool_stderr", nextState: next };
    }
    if (state.insideStandardOutput) {
      return { classification: "provider_tool_stdout", nextState: next };
    }
    if (state.insideStandardError) {
      return { classification: "provider_tool_stderr", nextState: next };
    }
    return { classification: "provider_task_progress", nextState: next };
  }

  // --- Block: thought ---
  if (trimmed === "<thought>" || trimmed === "<<thought>>") {
    next.insideThought = true;
    return { classification: "hidden_reasoning", nextState: next };
  }
  if (trimmed === "</thought>" || trimmed === "<</thought>>") {
    next.insideThought = false;
    return { classification: "hidden_reasoning", nextState: next };
  }
  if (state.insideThought) {
    return { classification: "hidden_reasoning", nextState: next };
  }

  // --- Top-level Standard Output/Error sections (outside task_progress) ---
  if (STD_OUT_RE.test(trimmed)) {
    next.insideStandardOutput = true;
    next.insideStandardError = false;
    return { classification: "provider_tool_stdout", nextState: next };
  }
  if (STD_ERR_RE.test(trimmed)) {
    next.insideStandardError = true;
    next.insideStandardOutput = false;
    return { classification: "provider_tool_stderr", nextState: next };
  }
  if (state.insideStandardOutput) {
    // A blank line exits the stdout section
    if (trimmed === "") {
      next.insideStandardOutput = false;
      return { classification: "provider_tool_stdout", nextState: next };
    }
    return { classification: "provider_tool_stdout", nextState: next };
  }
  if (state.insideStandardError) {
    if (trimmed === "") {
      next.insideStandardError = false;
      return { classification: "provider_tool_stderr", nextState: next };
    }
    return { classification: "provider_tool_stderr", nextState: next };
  }

  // --- Line-level patterns ---
  if (BG_TASK_RE.test(trimmed)) {
    return { classification: "provider_task_progress", nextState: next };
  }

  if (trimmed === "An event occurred.") {
    return { classification: "provider_protocol", nextState: next };
  }

  // Auth phrases (case-insensitive prefix match)
  const lower = trimmed.toLowerCase();
  for (const phrase of AUTH_PHRASES) {
    if (lower.startsWith(phrase)) {
      return { classification: "provider_auth", nextState: next };
    }
  }
  // "Authenticated" alone
  if (lower === "authenticated") {
    return { classification: "provider_auth", nextState: next };
  }

  // OAuth / auth URLs
  if (AUTH_URL_RE.test(trimmed) || PLEASE_VISIT_RE.test(trimmed)) {
    return { classification: "sensitive_auth_url", nextState: next };
  }

  // Probe: READY
  if (trimmed === "READY") {
    return { classification: "provider_probe", nextState: next };
  }

  // Probe: MODEL=...; REASONING=...
  if (MODEL_PROBE_RE.test(trimmed)) {
    return { classification: "provider_probe", nextState: next };
  }

  // Prompt echo suppression
  if (state.promptToSuppress && trimmed === state.promptToSuppress) {
    return { classification: "provider_protocol", nextState: next };
  }

  return { classification: "assistant_output", nextState: next };
}

export interface ClassifiedLine {
  line: string;
  classification: AntigravityOutputClass;
}

export function classifyLines(
  rawLines: string[],
  initialState: ClassifierState,
): ClassifiedLine[] {
  let state = initialState;
  const result: ClassifiedLine[] = [];
  for (const line of rawLines) {
    const { classification, nextState } = classifyLine(line, state);
    result.push({ line, classification });
    state = nextState;
  }
  return result;
}

export function extractAssistantOutput(classified: ClassifiedLine[]): string | null {
  const assistantLines = classified
    .filter((c) => c.classification === "assistant_output")
    .map((c) => c.line);
  if (assistantLines.length === 0) return null;
  const joined = assistantLines.join("\n").trim();
  return joined.length > 0 ? joined : null;
}
