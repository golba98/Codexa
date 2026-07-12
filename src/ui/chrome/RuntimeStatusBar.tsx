import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme.js";
import type { Layout } from "../layout.js";
import * as renderDebug from "../../core/perf/renderDebug.js";

export type RuntimeAvailability = "available" | "checking" | "reconnecting" | "unavailable" | "unknown";

export interface RuntimeStatusBarProps {
  layout: Layout;
  modelDisplay: string;
  contextDisplay?: string;
  availability?: RuntimeAvailability;
}

export function measureRuntimeStatusBarRows(): number {
  return 1;
}

function getAvailabilityLabel(availability: RuntimeAvailability | undefined): string | null {
  if (availability === "checking") return "checking";
  if (availability === "reconnecting") return "reconnecting";
  if (availability === "unavailable") return "unavailable";
  if (availability === "unknown") return "Unknown";
  return null;
}

function renderRuntimeDisplay(displayStr: string, theme: ReturnType<typeof useTheme>) {
  const safeDisplay = displayStr.trim() || "Local / Detecting...";
  const slashIndex = safeDisplay.indexOf("/");
  if (slashIndex === -1) {
    return <Text color={theme.model} wrap="truncate">{safeDisplay}</Text>;
  }

  const providerPart = safeDisplay.substring(0, slashIndex).trim() || "Local";
  const remaining = safeDisplay.substring(slashIndex + 1).trim() || "Detecting...";
  const parenIndex = remaining.indexOf("(");

  if (parenIndex === -1) {
    return (
      <Box flexDirection="row" overflow="hidden">
        <Text color={theme.provider}>{providerPart}</Text>
        <Text color={theme.textMuted}>{" / "}</Text>
        <Text color={theme.model}>{remaining}</Text>
      </Box>
    );
  }

  const modelPart = remaining.substring(0, parenIndex).trim();
  let reasoningPart = remaining.substring(parenIndex + 1).trim();
  if (reasoningPart.endsWith(")")) {
    reasoningPart = reasoningPart.substring(0, reasoningPart.length - 1).trim();
  }

  return (
    <Box flexDirection="row" overflow="hidden">
      <Text color={theme.provider}>{providerPart}</Text>
      <Text color={theme.textMuted}>{" / "}</Text>
      <Text color={theme.model}>{modelPart}</Text>
      <Text color={theme.textMuted}>{" ("}</Text>
      <Text color={theme.accentMuted}>{reasoningPart}</Text>
      <Text color={theme.textMuted}>{")"}</Text>
    </Box>
  );
}

export function RuntimeStatusBar({
  layout,
  modelDisplay,
  contextDisplay,
  availability = "available",
}: RuntimeStatusBarProps) {
  const theme = useTheme();
  const availabilityLabel = getAvailabilityLabel(availability);
  const safeModelDisplay = modelDisplay.trim() || "Local / Detecting...";
  const safeContextDisplay = contextDisplay?.trim() || "Unknown";
  renderDebug.useRenderDebug("RuntimeStatusBar", {
    modelDisplay: safeModelDisplay,
    contextDisplay: safeContextDisplay,
    availability,
    cols: layout.cols,
  });

  return (
    <Box
      height={measureRuntimeStatusBarRows()}
      width="100%"
      paddingLeft={1}
      paddingRight={1}
      justifyContent="space-between"
      overflow="hidden"
    >
      <Box flexGrow={1} flexShrink={1} overflow="hidden" flexDirection="row">
        {renderRuntimeDisplay(safeModelDisplay, theme)}
        {availabilityLabel && (
          <>
            <Text color={theme.textMuted}>{" · "}</Text>
            <Text color={availability === "unavailable" ? theme.warning : theme.info}>{availabilityLabel}</Text>
          </>
        )}
      </Box>
      <Box flexShrink={0}>
        <Text color={theme.textMuted}>{layout.cols >= 48 ? "Context: " : "Ctx: "}</Text>
        <Text color={safeContextDisplay === "Unknown" ? theme.textDim : theme.context}>{safeContextDisplay}</Text>
      </Box>
    </Box>
  );
}
