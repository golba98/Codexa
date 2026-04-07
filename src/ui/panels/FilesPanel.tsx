/**
 * FilesPanel — displays progressive list of files being inspected.
 */

import React from "react";
import { Box, Text } from "ink";
import { truncatePath } from "../displayText.js";
import { useTheme } from "../theme.js";
import { getUsableShellWidth } from "../layout.js";
import { getTextWidth, wrapPlainText } from "../textLayout.js";
import type { FileInspection } from "../../orchestration/panelState.js";

interface FilesPanelProps {
  cols: number;
  title?: string;
  files: FileInspection[];
  complete?: boolean;
  totalCount?: number;
  maxVisible?: number;
}

const STATUS_ICONS: Record<string, string> = {
  queued: "○",
  reading: "◐",
  analyzed: "●",
  done: "✓",
  skipped: "–",
};

const STATUS_COLORS: Record<string, "SUCCESS" | "MUTED" | "DIM" | "INFO"> = {
  queued: "DIM",
  reading: "INFO",
  analyzed: "SUCCESS",
  done: "SUCCESS",
  skipped: "DIM",
};

export function FilesPanel({
  cols,
  title = "Files Inspected",
  files,
  complete = false,
  totalCount,
  maxVisible = 8,
}: FilesPanelProps) {
  const theme = useTheme();

  // Show nothing if no files
  if (files.length === 0 && complete) return null;

  const visibleFiles = files.slice(-maxVisible);
  const hiddenCount = Math.max(0, files.length - maxVisible);
  const sectionCols = Math.max(1, getUsableShellWidth(cols, 2));
  const contentWidth = Math.max(1, sectionCols - 2);

  return (
    <Box marginBottom={1} width="100%" paddingLeft={2}>
      <Box flexDirection="column" width="100%">
        {hiddenCount > 0 && (
          <Text color={theme.DIM}>... and {hiddenCount} more above</Text>
        )}
        {visibleFiles.map((file, idx) => {
          const icon = STATUS_ICONS[file.status] ?? "○";
          const colorKey = STATUS_COLORS[file.status] ?? "MUTED";
          const iconColor = theme[colorKey];
          const prefix = `${icon} `;
          const displayPath = truncatePath(file.path, Math.max(1, contentWidth - getTextWidth(prefix)));
          const reasonRows = file.reason
            ? wrapPlainText(file.reason, Math.max(1, contentWidth - 2))
            : [];

          return (
            <Box key={file.path + idx} flexDirection="column" width="100%">
              <Box width="100%">
                <Text color={iconColor}>{prefix}</Text>
                <Text color={theme.TEXT}>{displayPath}</Text>
              </Box>
              {reasonRows.map((row, rowIndex) => (
                <Box key={`${file.path}-${rowIndex}`} paddingLeft={2} width="100%">
                  <Text color={theme.DIM}>{row || " "}</Text>
                </Box>
              ))}
            </Box>
          );
        })}
        {files.length === 0 && !complete && (
          <Text color={theme.DIM}>Discovering files...</Text>
        )}
      </Box>
    </Box>
  );
}
