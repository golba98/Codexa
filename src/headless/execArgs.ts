import type { LaunchArgs } from "../config/launchArgs.js";

export interface HeadlessExecArgs {
  help: boolean;
  prompt: string;
  launchArgs: LaunchArgs;
}

export type HeadlessExecArgsParseResult =
  | { ok: true; value: HeadlessExecArgs }
  | { ok: false; error: string };

function normalizeNonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseConfigFlagValue(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }

  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    return null;
  }

  return trimmed;
}

function buildLaunchArgs(params: {
  prompt: string | null;
  profile: string | null;
  configOverrides: string[];
  passthroughArgs: string[];
}): LaunchArgs {
  return {
    help: false,
    version: false,
    initialPrompt: params.prompt,
    profile: params.profile,
    configOverrides: params.configOverrides,
    passthroughArgs: params.passthroughArgs,
  };
}

export function parseHeadlessExecArgs(argv: readonly string[]): HeadlessExecArgsParseResult {
  const configOverrides: string[] = [];
  const passthroughArgs: string[] = [];
  const positionalPromptParts: string[] = [];
  let explicitPrompt: string | null = null;
  let profile: string | null = null;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--") {
      positionalPromptParts.push(...argv.slice(index + 1));
      break;
    }

    if (arg === "--prompt") {
      const value = normalizeNonEmpty(argv[index + 1]);
      if (!value) {
        return { ok: false, error: "Missing value for --prompt." };
      }
      explicitPrompt = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--prompt=")) {
      const value = normalizeNonEmpty(arg.slice("--prompt=".length));
      if (!value) {
        return { ok: false, error: "Missing value for --prompt." };
      }
      explicitPrompt = value;
      continue;
    }

    if (arg === "--profile") {
      const value = normalizeNonEmpty(argv[index + 1]);
      if (!value) {
        return { ok: false, error: "Missing value for --profile." };
      }
      profile = value;
      passthroughArgs.push(arg, value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--profile=")) {
      const value = normalizeNonEmpty(arg.slice("--profile=".length));
      if (!value) {
        return { ok: false, error: "Missing value for --profile." };
      }
      profile = value;
      passthroughArgs.push(`--profile=${value}`);
      continue;
    }

    if (arg === "-c" || arg === "--config") {
      const value = parseConfigFlagValue(argv[index + 1]);
      if (!value) {
        return { ok: false, error: `Missing key=value payload for ${arg}.` };
      }
      configOverrides.push(value);
      passthroughArgs.push(arg, value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--config=")) {
      const value = parseConfigFlagValue(arg.slice("--config=".length));
      if (!value) {
        return { ok: false, error: "Missing key=value payload for --config." };
      }
      configOverrides.push(value);
      passthroughArgs.push(`--config=${value}`);
      continue;
    }

    if (arg.startsWith("-c=")) {
      const value = parseConfigFlagValue(arg.slice(3));
      if (!value) {
        return { ok: false, error: "Missing key=value payload for -c." };
      }
      configOverrides.push(value);
      passthroughArgs.push(`-c=${value}`);
      continue;
    }

    if (arg.startsWith("-")) {
      return { ok: false, error: `Unknown option for codexa exec: ${arg}` };
    }

    positionalPromptParts.push(arg, ...argv.slice(index + 1));
    break;
  }

  const positionalPrompt = positionalPromptParts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .trim() || null;

  if (explicitPrompt && positionalPrompt) {
    return { ok: false, error: "Provide a prompt either positionally or with --prompt, not both." };
  }

  const prompt = explicitPrompt ?? positionalPrompt;
  if (help) {
    return {
      ok: true,
      value: {
        help,
        prompt: prompt ?? "",
        launchArgs: buildLaunchArgs({ prompt, profile, configOverrides, passthroughArgs }),
      },
    };
  }

  if (!prompt) {
    return { ok: false, error: "Missing prompt. Use codexa exec \"prompt\" or codexa exec --prompt \"prompt\"." };
  }

  return {
    ok: true,
    value: {
      help,
      prompt,
      launchArgs: buildLaunchArgs({ prompt, profile, configOverrides, passthroughArgs }),
    },
  };
}
