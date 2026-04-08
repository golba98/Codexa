export interface SanitizeTerminalOptions {
  preserveTabs?: boolean;
  tabSize?: number;
}

const DEFAULT_TAB_SIZE = 2;
const OSC_SEQUENCE = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g;
const CSI_SEQUENCE = /\u001B\[[0-?]*[ -/]*[@-~]/g;
const ESC_INTERMEDIATE_SEQUENCE = /\u001B[@-Z\\-_]/g;
const DCS_PM_APC_SEQUENCE = /\u001B[PX^_][\s\S]*?\u001B\\/g;
const SINGLE_C1_SEQUENCE = /[\u0080-\u009F]/g;
const DISALLOWED_CONTROL_BYTES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function normalizeTabs(text: string, preserveTabs: boolean, tabSize: number): string {
  if (preserveTabs) return text;
  return text.replace(/\t/g, " ".repeat(Math.max(1, tabSize)));
}

function stripTerminalSequences(raw: string): string {
  return raw
    .replace(OSC_SEQUENCE, "")
    .replace(DCS_PM_APC_SEQUENCE, "")
    .replace(CSI_SEQUENCE, "")
    .replace(ESC_INTERMEDIATE_SEQUENCE, "")
    .replace(SINGLE_C1_SEQUENCE, "");
}

function stripUnsafeControls(text: string): string {
  return text.replace(DISALLOWED_CONTROL_BYTES, "");
}

export function sanitizeTerminalOutput(raw: string, options: SanitizeTerminalOptions = {}): string {
  if (!raw) return "";
  const preserveTabs = options.preserveTabs ?? false;
  const tabSize = options.tabSize ?? DEFAULT_TAB_SIZE;

  const withoutSequences = stripTerminalSequences(raw);
  const normalizedBreaks = withoutSequences
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const withoutUnsafeControls = stripUnsafeControls(normalizedBreaks);
  return normalizeTabs(withoutUnsafeControls, preserveTabs, tabSize);
}

export function sanitizeTerminalInput(raw: string): string {
  return sanitizeTerminalOutput(raw, { preserveTabs: false, tabSize: DEFAULT_TAB_SIZE });
}

export function sanitizeTerminalLines(lines: string[]): string[] {
  return lines
    .map((line) => sanitizeTerminalOutput(line))
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}
