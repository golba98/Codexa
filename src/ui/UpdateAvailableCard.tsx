import React from "react";
import { Box, Text } from "ink";
import { CODEXA_UPDATE_COMMAND } from "../core/updateCheck.js";
import { clampVisualText } from "./layout.js";
import { useTheme } from "./theme.js";

export const UPDATE_CARD_CONTENT_ROWS = 4; // title + available + using + command
export const UPDATE_CARD_ROWS = UPDATE_CARD_CONTENT_ROWS + 2; // +2 for top/bottom border rows

export interface UpdateAvailableCardProps {
  latestVersion: string;
  currentVersion: string;
  /** Total box width including borders. Long lines are truncated to fit. */
  width?: number;
}

export function UpdateAvailableCard({ latestVersion, currentVersion, width }: UpdateAvailableCardProps) {
  const theme = useTheme();
  const command = `Run: ${CODEXA_UPDATE_COMMAND}@latest`;
  // Inner content width = boxWidth - 2 (left/right border cols)
  const innerWidth = width !== undefined ? Math.max(8, width - 2) : undefined;

  function clamp(text: string): string {
    return innerWidth !== undefined ? clampVisualText(text, innerWidth) : text;
  }

  return (
    <Box
      borderStyle="round"
      borderColor={theme.ACCENT}
      flexDirection="column"
      width={width}
      flexShrink={0}
    >
      <Text color={theme.TEXT} bold>{clamp("Update available")}</Text>
      <Text color={theme.MUTED}>{clamp(`Codexa ${latestVersion} is available`)}</Text>
      <Text color={theme.MUTED}>{clamp(`You are using ${currentVersion}`)}</Text>
      <Text color={theme.DIM}>{clamp(command)}</Text>
    </Box>
  );
}
