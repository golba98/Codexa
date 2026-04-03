import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "./theme.js";
import type { LayoutMode } from "./layout.js";

// Full 6-line Unicode banner — rendered only in "full" mode.
const BANNER = [
  " ██████╗ ██████╗ ██████╗ ███████╗██╗  ██╗ █████╗ ",
  "██╔════╝██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝██╔══██╗",
  "██║     ██║   ██║██║  ██║█████╗   ╚███╔╝ ███████║",
  "██║     ██║   ██║██║  ██║██╔══╝   ██╔██╗ ██╔══██║",
  "╚██████╗╚██████╔╝██████╔╝███████╗██╔╝ ██╗██║  ██║",
  " ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝",
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

  // Full mode — 6-line Unicode banner, truncated (never wrapped) so block
  // characters can't collide across lines and create the smeared-block glitch.
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
