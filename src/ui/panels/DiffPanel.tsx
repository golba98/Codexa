/**
 * DiffPanel — displays code diffs with syntax highlighting.
 */

import React from "react";
import { Box, Text } from "ink";
import { truncateEnd, truncatePath } from "../displayText.js";
import { useTheme } from "../theme.js";
import { getUsableShellWidth } from "../layout.js";
import { getTextWidth } from "../textLayout.js";
import type { DiffEntry } from "../../orchestration/panelState.js";

interface DiffPanelProps {
  cols: number;
  diffs: DiffEntry[];
  title?: string;
  maxLinesPerDiff?: number;
}

export function DiffPanel({
  cols,
  diffs,
  title = "Changes",
  maxLinesPerDiff = 30,
}: DiffPanelProps) {
  const theme = useTheme();

  // Show nothing if no diffs
  if (diffs.length === 0) return null;

  const sectionCols = Math.max(1, getUsableShellWidth(cols, 2));
  const contentWidth = sectionCols - 2;

  return (
    <Box marginBottom={1} width="100%" paddingLeft={2}>
      <Box flexDirection="column" width="100%">
        {diffs.map((diff, idx) => (
          <DiffBlock
            key={diff.file + idx}
            file={diff.file}
            patch={diff.patch}
            language={diff.language}
            status={diff.status}
            contentWidth={contentWidth}
            maxLines={maxLinesPerDiff}
            isLast={idx === diffs.length - 1}
          />
        ))}
      </Box>
    </Box>
  );
}

// ─── Diff Block Component ─────────────────────────────────────────────────────

interface DiffBlockProps {
  file: string;
  patch: string;
  language?: string;
  status: "streaming" | "complete";
  contentWidth: number;
  maxLines: number;
  isLast: boolean;
}

function DiffBlock({
  file,
  patch,
  language,
  status,
  contentWidth,
  maxLines,
  isLast,
}: DiffBlockProps) {
  const theme = useTheme();

  const lines = patch.split("\n");
  const visibleLines = lines.slice(0, maxLines);
  const hiddenCount = Math.max(0, lines.length - maxLines);
  const headerSuffix = `${language ? ` (${language})` : ""}${status === "streaming" ? " ..." : ""}`;
  const headerFileWidth = Math.max(1, contentWidth - getTextWidth(headerSuffix));
  const displayFile = truncatePath(file, headerFileWidth);

  return (
    <Box flexDirection="column" marginBottom={isLast ? 0 : 1} width="100%">
      {/* File header */}
      <Box width="100%">
        <Text color={theme.INFO} bold>
          {displayFile}
        </Text>
        {language && (
          <Text color={theme.DIM}> ({language})</Text>
        )}
        {status === "streaming" && (
          <Text color={theme.ACCENT}> ...</Text>
        )}
      </Box>

      {/* Diff content */}
      <Box flexDirection="column" paddingLeft={1} marginTop={0} width="100%">
        {visibleLines.map((line, idx) => {
          const trimmed = line.trimStart();
          let lineColor = theme.TEXT;
          let prefix = "  ";

          if (trimmed.startsWith("+") && !trimmed.startsWith("+++")) {
            lineColor = theme.SUCCESS;
            prefix = "+ ";
          } else if (trimmed.startsWith("-") && !trimmed.startsWith("---")) {
            lineColor = theme.ERROR;
            prefix = "- ";
          } else if (trimmed.startsWith("@@")) {
            lineColor = theme.INFO;
            prefix = "@ ";
          } else {
            prefix = "  ";
          }

          // Truncate long lines
          const displayLine = truncateEnd(line, Math.max(1, contentWidth - 2));

          return (
            <Box key={idx} width="100%">
              <Text color={lineColor}>
                {prefix.slice(0, 2)}
                {displayLine.slice(prefix === "  " ? 0 : 1) || " "}
              </Text>
            </Box>
          );
        })}

        {hiddenCount > 0 && (
          <Text color={theme.DIM}>... {hiddenCount} more lines</Text>
        )}
      </Box>
    </Box>
  );
}
