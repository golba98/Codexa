export interface LaunchArgs {
  help: boolean;
  version: boolean;
  initialPrompt: string | null;
  profile: string | null;
  configOverrides: string[];
  passthroughArgs: string[];
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

  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    return null;
  }

  return trimmed;
}

export function parseLaunchArgs(argv: readonly string[]): LaunchArgsParseResult {
  const passthroughArgs: string[] = [];
  const configOverrides: string[] = [];
  const promptArgs: string[] = [];
  let help = false;
  let version = false;
  let profile: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === "--") {
      promptArgs.push(...argv.slice(index + 1));
      break;
    }

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--version" || arg === "-v") {
      version = true;
      continue;
    }

    if (arg === "--profile") {
      const value = normalizeProfileValue(argv[index + 1]);
      if (!value) {
        return { ok: false, error: "Missing value for --profile." };
      }
      profile = value;
      passthroughArgs.push(arg, value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--profile=")) {
      const value = normalizeProfileValue(arg.slice("--profile=".length));
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

  return {
    ok: true,
    value: {
      help,
      version,
      initialPrompt,
      profile,
      configOverrides,
      passthroughArgs,
    },
  };
}
