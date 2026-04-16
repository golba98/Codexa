import type { RunProgressBlock, RunProgressEntry, RunProgressSource } from "../session/types.js";
import { sanitizeTerminalOutput } from "../core/terminalSanitize.js";
import { wrapPlainText } from "./textLayout.js";

export interface VisibleProgressBlock {
  id: string;
  key: string;
  label: string;
  text: string;
  source: RunProgressSource;
  entryId: string;
  entrySequence: number;
  blockSequence: number;
  status: RunProgressBlock["status"];
}

export interface VisibleProgressBlocks {
  hiddenCount: number;
  totalCount: number;
  blocks: VisibleProgressBlock[];
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
        text: block.text,
        source: entry.source,
        entryId: entry.id,
        entrySequence: entry.sequence,
        blockSequence: block.sequence,
        status: block.status,
      });
    }
  }

  return blocks;
}

export function getProgressUpdateCount(entries: RunProgressEntry[]): number {
  return toVisibleProgressBlocks(entries).length;
}

export function selectVisibleProgressBlocks(entries: RunProgressEntry[], maxVisible: number): VisibleProgressBlocks {
  const blocks = toVisibleProgressBlocks(entries);
  const safeMax = Math.max(0, maxVisible);
  if (blocks.length <= safeMax) {
    return {
      hiddenCount: 0,
      totalCount: blocks.length,
      blocks,
    };
  }

  return {
    hiddenCount: blocks.length - safeMax,
    totalCount: blocks.length,
    blocks: blocks.slice(-safeMax),
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
