import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { formatModeLabel } from "../config/settings.js";
import type { ModelSpec } from "../core/modelSpecs.js";
import { useTheme } from "./theme.js";
import type { Layout } from "./layout.js";
import { getModeColor } from "./modeColor.js";

interface StatusBarProps {
  layout: Layout;
  model: string;
  mode: string;
  reasoningLevel?: string;
  tokensUsed: number;
  modelSpec: ModelSpec;
}

function formatApprox(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

export function StatusBar({
  layout,
  model,
  mode,
  reasoningLevel,
  tokensUsed,
  modelSpec,
}: StatusBarProps) {
  const theme = useTheme();
  const { cols } = layout;

  const modeColor = getModeColor(mode, theme);
  const modeLabel = formatModeLabel(mode).toUpperCase();
  const reasoningSuffix = reasoningLevel ? ` (${reasoningLevel})` : "";
  const modelInfo = `${model}${reasoningSuffix}`;
  
  const ctxPct = modelSpec.status === "verified" && modelSpec.contextWindow > 0
    ? Math.min(100, Math.round((tokensUsed / modelSpec.contextWindow) * 100))
    : 0;
    
  const ctxLabel = `${formatApprox(tokensUsed)}/${modelSpec.contextWindow ? formatApprox(modelSpec.contextWindow) : "???"} ctx`;
  const pctLabel = `${ctxPct}%`;

  return (
    <Box 
      width="100%" 
      height={1} 
      paddingX={1} 
      flexDirection="row" 
      justifyContent="space-between"
    >
      <Box flexDirection="row">
        <Text color={modeColor} bold>{modeLabel}</Text>
        <Text color={theme.DIM}>  </Text>
        <Text color={theme.TEXT}>{modelInfo}</Text>
        <Text color={theme.DIM}>  </Text>
        <Text color={theme.MUTED}>Ctrl+M</Text>
      </Box>

      <Box flexDirection="row">
        <Text color={theme.DIM}>{ctxLabel}  </Text>
        <Text color={ctxPct > 80 ? theme.WARNING : theme.DIM} bold>{pctLabel}</Text>
      </Box>
    </Box>
  );
}

