import React from "react";
import { Box, Text } from "ink";
import { formatAuthPreferenceLabel, formatModeLabel } from "../config/settings.js";
import { getModeColor } from "./modeColor.js";
import { useTheme } from "./theme.js";

interface StatusStripProps {
  backendLabel: string;
  mode: string;
  authPreference: string;
  authLabel: string;
  slashPreview: string;
}

export function StatusStrip({
  backendLabel,
  mode,
  authPreference,
  authLabel,
  slashPreview,
}: StatusStripProps) {
  const theme = useTheme();
  const modeColor = getModeColor(mode, theme);

  return (
    <Box paddingX={1} marginTop={1} flexDirection="column">
      <Text color={theme.DIM}>
        /backend <Text color={theme.TEXT} bold>{backendLabel}</Text>
        {"    "}/mode <Text color={modeColor} bold>{formatModeLabel(mode)}</Text>
        {"    "}/auth <Text color={theme.TEXT} bold>{formatAuthPreferenceLabel(authPreference)}</Text>
        {"    "}state <Text color={theme.INFO}>{authLabel}</Text>
        {"    "}hint <Text color={theme.PROMPT}>{slashPreview}</Text>
      </Text>
    </Box>
  );
}
