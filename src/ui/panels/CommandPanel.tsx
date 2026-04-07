/**
 * CommandPanel — displays suggested shell commands with copy support.
 */

import React from "react";
import { Box, Text } from "ink";
import { truncateEnd } from "../displayText.js";
import { useTheme } from "../theme.js";
import { getUsableShellWidth } from "../layout.js";
import { getTextWidth, wrapPlainText } from "../textLayout.js";
import type { CommandEntry } from "../../orchestration/panelState.js";

interface CommandPanelProps {
  cols: number;
  commands: CommandEntry[];
  title?: string;
}

export function CommandPanel({
  cols,
  commands,
  title = "Commands",
}: CommandPanelProps) {
  const theme = useTheme();

  // Show nothing if no commands
  if (commands.length === 0) return null;

  // Enforce 3 commands in 80x24 mode, otherwise default to all
  const maxVisible = cols <= 80 ? 3 : commands.length;
  const visibleCommands = commands.slice(0, maxVisible);
  const hiddenCount = Math.max(0, commands.length - maxVisible);

  const sectionCols = Math.max(1, getUsableShellWidth(cols, 2));
  const contentWidth = sectionCols - 2;

  return (
    <Box marginBottom={1} width="100%" paddingLeft={2}>
      <Box flexDirection="column" width="100%">
        {visibleCommands.map((cmd, idx) => (
          <CommandBlock
            key={idx}
            content={cmd.content}
            description={cmd.description}
            copyable={cmd.copyable}
            contentWidth={contentWidth}
            isLast={idx === visibleCommands.length - 1 && hiddenCount === 0}
          />
        ))}
        {hiddenCount > 0 && (
          <Text color={theme.DIM}>… {hiddenCount} more commands hidden below</Text>
        )}
      </Box>
    </Box>
  );
}

// ─── Command Block Component ──────────────────────────────────────────────────

interface CommandBlockProps {
  content: string;
  description?: string;
  copyable: boolean;
  contentWidth: number;
  isLast: boolean;
}

function CommandBlock({
  content,
  description,
  copyable,
  contentWidth,
  isLast,
}: CommandBlockProps) {
  const theme = useTheme();

  // Split multi-line commands
  const lines = content.split("\n").filter((l) => l.trim());
  const prefix = "$ ";
  const availableLineWidth = Math.max(1, contentWidth - getTextWidth(prefix));
  const hint = copyable && lines.length === 1 ? `(use !${lines[0]} to execute)` : null;

  return (
    <Box flexDirection="column" marginBottom={isLast ? 0 : 1} width="100%">
      {/* Description if present */}
      {description && (
        <Box flexDirection="column" width="100%">
          {wrapPlainText(description, Math.max(1, contentWidth)).map((row, index) => (
            <Text key={index} color={theme.MUTED}>{row || " "}</Text>
          ))}
        </Box>
      )}

      {/* Command content */}
      <Box flexDirection="column" width="100%">
        {lines.map((line, idx) => {
          const wrapped = wrapPlainText(line, availableLineWidth);

          return (
            <Box key={idx} flexDirection="column" width="100%">
              {wrapped.map((row, rowIndex) => (
                <Box key={rowIndex} width="100%">
                  <Text color={theme.ACCENT}>{rowIndex === 0 ? prefix : "  "}</Text>
                  <Text color={theme.TEXT}>{row || " "}</Text>
                </Box>
              ))}
            </Box>
          );
        })}
      </Box>

      {/* Copy hint */}
      {hint && (
        <Text color={theme.DIM} dimColor>
          {truncateEnd(hint, Math.max(1, contentWidth))}
        </Text>
      )}
    </Box>
  );
}
