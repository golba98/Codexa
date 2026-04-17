import type { RunProgressBlock, RunProgressEntry, RunProgressSource } from "../session/types.js";
import { sanitizeTerminalOutput } from "../core/terminalSanitize.js";
import { wrapPlainText } from "./textLayout.js";

export interface VisibleProgressBlock {
  id: string;
  key: string;
  label: string;
  headline: string;
  text: string;
  source: RunProgressSource;
  entryId: string;
  entrySequence: number;
  blockSequence: number;
  status: RunProgressBlock["status"];
  isLatest: boolean;
  isActive: boolean;
}

export interface VisibleProgressBlocks {
  hiddenCount: number;
  totalCount: number;
  blocks: VisibleProgressBlock[];
  latestBlock: VisibleProgressBlock | null;
  latestActiveBlock: VisibleProgressBlock | null;
}

function sourceLabel(source: RunProgressSource): string {
  switch (source) {
    case "reasoning":
      return "Reasoning";
    case "todo":
      return "Todo";
    case "tool":
      return "Tool";
    case "activity":
      return "Activity";
    case "stderr":
      return "Process";
    case "transcript":
      return "Progress";
    default:
      return "Update";
  }
}

function firstMeaningfulLine(text: string): string {
  return sanitizeTerminalOutput(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

function buildProgressHeadline(source: RunProgressSource, text: string, status: RunProgressBlock["status"]): string {
  const label = status === "active" ? "Current" : sourceLabel(source);
  const firstLine = firstMeaningfulLine(text);
  return firstLine ? `${label}: ${firstLine}` : label;
}

function toVisibleProgressBlocks(entries: RunProgressEntry[]): VisibleProgressBlock[] {
  const blocks: VisibleProgressBlock[] = [];
  let visibleSequence = 0;

  for (const entry of entries) {
    for (const block of entry.blocks) {
      if (!block.text.trim()) continue;
      visibleSequence += 1;
      blocks.push({
        id: block.id,
        key: block.id,
        label: `Update ${visibleSequence}`,
        headline: buildProgressHeadline(entry.source, block.text, block.status),
        text: block.text,
        source: entry.source,
        entryId: entry.id,
        entrySequence: entry.sequence,
        blockSequence: block.sequence,
        status: block.status,
        isLatest: false,
        isActive: block.status === "active",
      });
    }
  }

  return blocks.map((block, index) => ({
    ...block,
    isLatest: index === blocks.length - 1,
  }));
}

export function getProgressUpdateCount(entries: RunProgressEntry[]): number {
  return toVisibleProgressBlocks(entries).length;
}

export function selectVisibleProgressBlocks(entries: RunProgressEntry[], maxVisible: number): VisibleProgressBlocks {
  const blocks = toVisibleProgressBlocks(entries);
  const safeMax = Math.max(0, maxVisible);
  const findLatestActiveBlock = (candidates: VisibleProgressBlock[]): VisibleProgressBlock | null => {
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      if (candidates[index]?.isActive) {
        return candidates[index]!;
      }
    }
    return null;
  };

  if (blocks.length <= safeMax) {
    return {
      hiddenCount: 0,
      totalCount: blocks.length,
      blocks,
      latestBlock: blocks[blocks.length - 1] ?? null,
      latestActiveBlock: findLatestActiveBlock(blocks),
    };
  }

  const visible = blocks.slice(-safeMax);
  return {
    hiddenCount: blocks.length - safeMax,
    totalCount: blocks.length,
    blocks: visible,
    latestBlock: visible[visible.length - 1] ?? null,
    latestActiveBlock: findLatestActiveBlock(visible),
  };
}

export function formatProgressBlockBodyLines(text: string, width: number): string[] {
  const contentWidth = Math.max(1, width);
  const normalized = sanitizeTerminalOutput(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n");

  if (!normalized.trim()) {
    return [" "];
  }

  const rows: string[] = [];
  for (const rawLine of normalized.split("\n")) {
    if (!rawLine.trim()) {
      rows.push("");
      continue;
    }

    const wrapped = wrapPlainText(rawLine, contentWidth);
    rows.push(...(wrapped.length > 0 ? wrapped : [" "]));
  }

  return rows.length > 0 ? rows : [" "];
}
