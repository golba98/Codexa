import type { ReasoningEffortCapability } from "../models/codexModelCapabilities.js";

export const CLAUDE_CODE_EFFORT_LEVELS: readonly ReasoningEffortCapability[] = [
  { id: "low", label: "Low", description: "Claude Code low effort." },
  { id: "medium", label: "Medium", description: "Claude Code medium effort." },
  { id: "high", label: "High", description: "Claude Code high effort." },
  { id: "xhigh", label: "XHigh", description: "Claude Code extra-high effort." },
  { id: "max", label: "Max", description: "Claude Code maximum effort." },
] as const;

export const CLAUDE_CODE_EFFORT_IDS = new Set(CLAUDE_CODE_EFFORT_LEVELS.map((level) => level.id));

export function getClaudeCodeEffortLevels(ids: readonly string[]): readonly ReasoningEffortCapability[] {
  return ids
    .map((id) => CLAUDE_CODE_EFFORT_LEVELS.find((level) => level.id === id))
    .filter((level): level is ReasoningEffortCapability => Boolean(level));
}
