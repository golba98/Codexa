import { EXTERNAL_SESSION_SOURCES, type ExternalSessionSource } from "../core/externalSessions/types.js";

const FLAG_HELP = "--help";
const FLAG_HELP_SHORT = "-h";
const FLAG_VERSION = "--version";
const FLAG_VERSION_SHORT = "-v";
const FLAG_PROFILE = "--profile";
const FLAG_CONFIG = "--config";
const FLAG_CONFIG_SHORT = "-c";
const FLAG_MODEL = "--model";
const FLAG_MODEL_SHORT = "-m";
const FLAG_NO_CLEAR = "--no-clear";

export interface LaunchArgs {
  help: boolean;
  version: boolean;
  initialPrompt: string | null;
  profile: string | null;
  configOverrides: string[];
  passthroughArgs: string[];
  /** Explicitly set when --model / -m was passed on the command line. Null when no model flag was given. */
  modelOverride: string | null;
  /** True when --no-clear was passed. Suppresses the startup terminal clear. */
  noClear: boolean;
  resumeId?: string;
  importSession?: { source: ExternalSessionSource; sessionId: string };
}

export type LaunchArgsParseResult =
  | { ok: true; value: LaunchArgs }
  | { ok: false; error: string };

function normalizeProfileValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseConfigFlagValue(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }

  // Require non-empty key and non-empty value on both sides of "="
  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    return null;
  }

  return trimmed;
}

function quoteTomlString(value: string): string {
  return JSON.stringify(value);
}

export function parseLaunchArgs(argv: readonly string[]): LaunchArgsParseResult {
  const passthroughArgs: string[] = [];
  const configOverrides: string[] = [];
  const promptArgs: string[] = [];
  let help = false;
  let version = false;
  let noClear = false;
  let profile: string | null = null;
  let modelOverride: string | null = null;
  let resumeId: string | undefined;
  let importSession: LaunchArgs["importSession"];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === "--resume" || arg.startsWith("--resume=") || arg === "--import-session" || arg.startsWith("--import-session=")) {
      const name = arg.split("=")[0]!;
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++index];
      if (!value || value.startsWith("--")) return { ok: false, error: `Missing value for ${name}.` };
      if (resumeId || importSession) return { ok: false, error: "Choose only one --resume or --import-session target." };
      if (name === "--resume") {
        if (!/^chat_[A-Za-z0-9-]+$/.test(value)) return { ok: false, error: "Invalid conversation ID for --resume." };
        resumeId = value;
      } else {
        const separator = value.indexOf(":");
        const source = value.slice(0, separator) as ExternalSessionSource;
        const sessionId = value.slice(separator + 1);
        if (separator < 0 || !EXTERNAL_SESSION_SOURCES.includes(source) || !/^[A-Za-z0-9_-]+$/.test(sessionId)) return { ok: false, error: "Use --import-session source:session-id (claude, codex, vibe, antigravity)." };
        importSession = { source, sessionId };
      }
      continue;
    }
    if (arg === "--") {
      promptArgs.push(...argv.slice(index + 1));
      break;
    }

    if (arg === FLAG_HELP || arg === FLAG_HELP_SHORT) {
      help = true;
      continue;
    }

    if (arg === FLAG_VERSION || arg === FLAG_VERSION_SHORT) {
      version = true;
      continue;
    }

    if (arg === FLAG_NO_CLEAR) {
      noClear = true;
      continue;
    }

    // --profile <value> and --profile=<value> both supported.
    if (arg === FLAG_PROFILE) {
      const value = normalizeProfileValue(argv[index + 1]);
      if (!value) {
        return { ok: false, error: `Missing value for ${FLAG_PROFILE}.` };
      }
      profile = value;
      passthroughArgs.push(arg, value);
      index += 1;
      continue;
    }

    if (arg.startsWith(`${FLAG_PROFILE}=`)) {
      const value = normalizeProfileValue(arg.slice(`${FLAG_PROFILE}=`.length));
      if (!value) {
        return { ok: false, error: `Missing value for ${FLAG_PROFILE}.` };
      }
      profile = value;
      passthroughArgs.push(`${FLAG_PROFILE}=${value}`);
      continue;
    }

    // --config / -c accept key=value pairs; both space-separated and inline = forms supported.
    if (arg === FLAG_CONFIG_SHORT || arg === FLAG_CONFIG) {
      const value = parseConfigFlagValue(argv[index + 1]);
      if (!value) {
        return { ok: false, error: `Missing key=value payload for ${arg}.` };
      }
      configOverrides.push(value);
      passthroughArgs.push(arg, value);
      index += 1;
      continue;
    }

    if (arg.startsWith(`${FLAG_CONFIG}=`)) {
      const value = parseConfigFlagValue(arg.slice(`${FLAG_CONFIG}=`.length));
      if (!value) {
        return { ok: false, error: `Missing key=value payload for ${FLAG_CONFIG}.` };
      }
      configOverrides.push(value);
      passthroughArgs.push(`${FLAG_CONFIG}=${value}`);
      continue;
    }

    if (arg.startsWith(`${FLAG_CONFIG_SHORT}=`)) {
      const value = parseConfigFlagValue(arg.slice(`${FLAG_CONFIG_SHORT}=`.length));
      if (!value) {
        return { ok: false, error: `Missing key=value payload for ${FLAG_CONFIG_SHORT}.` };
      }
      configOverrides.push(value);
      passthroughArgs.push(`${FLAG_CONFIG_SHORT}=${value}`);
      continue;
    }

    // --model / -m set the model via a config override, quoted for TOML.
    // Also captured in modelOverride so callers can distinguish "was --model given?"
    // from "what does layered config resolve to?" (which always has a default value).
    if (arg === FLAG_MODEL || arg === FLAG_MODEL_SHORT) {
      const value = normalizeProfileValue(argv[index + 1]);
      if (!value) {
        return { ok: false, error: `Missing value for ${arg}.` };
      }
      configOverrides.push(`model=${quoteTomlString(value)}`);
      passthroughArgs.push(arg, value);
      modelOverride = value;
      index += 1;
      continue;
    }

    if (arg.startsWith(`${FLAG_MODEL}=`)) {
      const value = normalizeProfileValue(arg.slice(`${FLAG_MODEL}=`.length));
      if (!value) {
        return { ok: false, error: `Missing value for ${FLAG_MODEL}.` };
      }
      configOverrides.push(`model=${quoteTomlString(value)}`);
      passthroughArgs.push(`${FLAG_MODEL}=${value}`);
      modelOverride = value;
      continue;
    }

    if (!arg.startsWith("-")) {
      promptArgs.push(arg, ...argv.slice(index + 1));
      break;
    }

    passthroughArgs.push(arg);
  }

  const initialPrompt = promptArgs
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .trim() || null;

  if ((resumeId || importSession) && initialPrompt) return { ok: false, error: "Resume/import opens a conversation without running a startup prompt." };
  return {
    ok: true,
    value: {
      help,
      version,
      initialPrompt,
      profile,
      configOverrides,
      passthroughArgs,
      modelOverride,
      noClear,
      ...(resumeId ? { resumeId } : {}),
      ...(importSession ? { importSession } : {}),
    },
  };
}
