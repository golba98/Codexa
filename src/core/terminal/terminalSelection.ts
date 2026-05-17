export interface TerminalSelectionProfile {
  id: "windows-terminal" | "vscode" | "xterm-like" | "unknown-vt";
  terminalLabel: string;
  selectionHint: string;
  shortHint: string;
  normalDragBehavior: string;
}

function isWindowsTerminal(env: Record<string, string | undefined>): boolean {
  return Boolean(env.WT_SESSION);
}

function isVsCodeTerminal(env: Record<string, string | undefined>): boolean {
  return (env.TERM_PROGRAM ?? "").toLowerCase() === "vscode";
}

function isXtermLike(env: Record<string, string | undefined>): boolean {
  const term = (env.TERM ?? "").toLowerCase();
  return /^(xterm|screen|tmux|rxvt|vt\d+|ansi|cygwin|linux)/.test(term);
}

export function getTerminalSelectionProfile(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform | string = process.platform,
): TerminalSelectionProfile {
  if (isWindowsTerminal(env)) {
    return {
      id: "windows-terminal",
      terminalLabel: "Windows Terminal",
      selectionHint: "Normal drag selects text after 1.5s idle while wheel scroll is active; use Shift+drag to select instantly.",
      shortHint: "Shift+drag selects",
      normalDragBehavior: "Normal drag selects after 1.5s idle; use Shift+drag to bypass app mouse mode.",
    };
  }

  if (isVsCodeTerminal(env)) {
    const mac = platform === "darwin";
    return {
      id: "vscode",
      terminalLabel: "VS Code integrated terminal",
      selectionHint: mac
        ? "Normal drag selects after 1.5s idle; use Option+drag to select instantly (requires VS Code override)."
        : "Normal drag selects after 1.5s idle; use Alt+drag to select instantly.",
      shortHint: mac ? "Option+drag selects" : "Alt+drag selects",
      normalDragBehavior: "Normal drag selects after 1.5s idle; use the terminal selection override modifier to select instantly.",
    };
  }

  if (isXtermLike(env)) {
    return {
      id: "xterm-like",
      terminalLabel: "xterm-compatible terminal",
      selectionHint: "Normal drag selects after 1.5s idle; use Shift+drag to select instantly.",
      shortHint: "Shift+drag selects",
      normalDragBehavior: "Normal drag selects after 1.5s idle; use Shift+drag to bypass app mouse mode.",
    };
  }

  return {
    id: "unknown-vt",
    terminalLabel: "VT-compatible terminal",
    selectionHint: "Normal drag selects after 1.5s idle; use the terminal mouse-selection override (commonly Shift+drag) to select instantly.",
    shortHint: "Shift+drag selects",
    normalDragBehavior: "Normal drag selects after 1.5s idle; use the terminal selection override modifier.",
  };
}
