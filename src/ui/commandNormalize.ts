import { formatTerminalAnswerInline } from "./terminalAnswerFormat.js";

function stripOuterQuotes(s: string): string {
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1);
  }
  return s;
}

function cleanCommand(command: string): string {
  return formatTerminalAnswerInline(command.trim());
}

/**
 * Strips shell-wrapper invocations from a command string and returns the inner
 * command that is actually being executed.
 *
 * Handles:
 *   "C:\Program Files\PowerShell\7\pwsh.exe" -Command '...'
 *   pwsh.exe -Command "..."
 *   powershell.exe -Command '...'
 *   cmd.exe /c "..."
 *   bash -lc '...'
 */
export function normalizeCommand(command: string): string {
  // Full quoted path ending with pwsh.exe / powershell.exe
  let match = command.match(/^"[^"]*(?:pwsh|powershell)(?:\.exe)?"\s+-Command\s+(.+)$/si);
  if (match) return cleanCommand(stripOuterQuotes(match[1].trim()));

  // Bare pwsh.exe / powershell.exe on PATH
  match = command.match(/^(?:pwsh|powershell)(?:\.exe)?\s+-Command\s+(.+)$/si);
  if (match) return cleanCommand(stripOuterQuotes(match[1].trim()));

  // cmd.exe /c "..."
  match = command.match(/^cmd(?:\.exe)?\s+\/[cC]\s+(.+)$/s);
  if (match) return cleanCommand(stripOuterQuotes(match[1].trim()));

  // bash -lc "..." or bash -lc '...'
  match = command.match(/^bash\s+-lc\s+(.+)$/s);
  if (match) return cleanCommand(stripOuterQuotes(match[1].trim()));

  return cleanCommand(command);
}

/**
 * Maps a normalized command to a short human-readable label.
 * Returns null when no label applies and the command itself should be shown.
 */
export function getFriendlyActionLabel(normalizedCommand: string): string | null {
  const cmd = normalizedCommand.trim();

  if (/^(?:Get-ChildItem|dir|ls)\b/i.test(cmd)) return "List files";
  if (/^rg\s+--files\b/i.test(cmd)) return "List files";
  if (/^(?:Get-Content|cat)\b/i.test(cmd)) return "Read file";
  if (/^git\s+status\b/.test(cmd)) return "Check git status";
  if (/^git\s+diff\b/.test(cmd)) return "Inspect changes";
  if (/^(?:bun|npm)\s+install\b/.test(cmd)) return "Install dependencies";
  if (/^(?:bun|npm)\s+test\b/.test(cmd)) return "Run tests";
  if (/^(?:tsc\b|bun\s+run\s+typecheck\b)/.test(cmd)) return "Run typecheck";

  return null;
}
