export interface TerminalCapabilityInput {
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  platform: NodeJS.Platform | string;
  env: Record<string, string | undefined>;
}

export interface TerminalCapabilityResult {
  supported: boolean;
  reason: "supported" | "notty" | "unsupported-terminal";
  message: string;
}

const WINDOWS_SUPPORTED_TERM_PATTERNS = [
  /^xterm/i,
  /^screen/i,
  /^tmux/i,
  /^vt\d+/i,
  /^ansi/i,
  /^cygwin/i,
  /^linux/i,
];

function hasSupportedWindowsTerminal(env: Record<string, string | undefined>): boolean {
  const term = env.TERM ?? "";
  const termProgram = env.TERM_PROGRAM ?? "";

  if (env.WT_SESSION) return true;
  if (env.ANSICON) return true;
  if ((env.ConEmuANSI ?? "").toUpperCase() === "ON") return true;
  if (termProgram.toLowerCase() === "vscode") return true;
  if (termProgram.toLowerCase() === "hyper") return true;
  if (termProgram.toLowerCase() === "jetbrains-jediterm") return true;

  return WINDOWS_SUPPORTED_TERM_PATTERNS.some((pattern) => pattern.test(term));
}

export function getTerminalCapability(input: TerminalCapabilityInput): TerminalCapabilityResult {
  if (!input.stdinIsTTY || !input.stdoutIsTTY) {
    return {
      supported: false,
      reason: "notty",
      message: "This UI requires an interactive terminal.",
    };
  }

  const term = (input.env.TERM ?? "").trim().toLowerCase();
  if (term === "dumb") {
    return {
      supported: false,
      reason: "unsupported-terminal",
      message: "This terminal does not support the VT control sequences required by the Codexa UI. Use a VT-compatible terminal such as Windows Terminal or the VS Code terminal.",
    };
  }

  if (input.platform !== "win32") {
    return {
      supported: true,
      reason: "supported",
      message: "",
    };
  }

  if (hasSupportedWindowsTerminal(input.env)) {
    return {
      supported: true,
      reason: "supported",
      message: "",
    };
  }

  return {
    supported: false,
    reason: "unsupported-terminal",
    message: "This terminal does not appear to support the VT control sequences required by the Codexa UI. Use Windows Terminal, the VS Code terminal, or another VT-compatible terminal.",
  };
}
