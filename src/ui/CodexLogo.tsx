import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "./theme.js";
import type { LayoutMode } from "./layout.js";

// Full 4-line ASCII banner — rendered only in "full" mode.
const BANNER = [
  "  ____   ___  ____  _____ _  __    _    ",
  " / ___| / _ \\|  _ \\| ____| |/ /   / \\   ",
  "| |    | | | | | | |  _| | ' /   / _ \\  ",
  "|_|     \\___/|_| |_|_____|_|\\_\\ /_/ \\_\\ "
];


interface CodexLogoProps {
  /** Which layout mode we're in. Defaults to "full". */
  layout?: LayoutMode;
}

export function CodexLogo({ layout = "full" }: CodexLogoProps) {
  const theme = useTheme();

  function colorForIndex(index: number): string {
    const palette = [theme.ACCENT, theme.INFO, theme.STAR];
    return palette[index % palette.length] ?? theme.ACCENT;
  }
  // Micro mode — no logo rendered at all
  if (layout === "micro") return null;

  // Compact mode — single colourful line: ✦ CODEXA
  if (layout === "compact") {
    return (
      <Box>
        <Text color={theme.ACCENT} bold>{"✦ "}</Text>
        <Text color={theme.ACCENT} bold>{"C"}</Text>
        <Text color={theme.INFO}   bold>{"O"}</Text>
        <Text color={theme.STAR}   bold>{"D"}</Text>
        <Text color={theme.ACCENT} bold>{"E"}</Text>
        <Text color={theme.INFO}   bold>{"X"}</Text>
        <Text color={theme.STAR}   bold>{"A"}</Text>
      </Box>
    );
  }

  // Full mode — ASCII banner to stay stable across terminals/codepages.
  return (
    <Box flexDirection="column" overflow="hidden">
      {BANNER.map((line, index) => (
        <Text key={line} color={colorForIndex(index)} wrap="truncate">
          {line}
        </Text>
      ))}
    </Box>
  );
}
