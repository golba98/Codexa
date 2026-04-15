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
    return theme.LOGO[index % theme.LOGO.length] ?? theme.LOGO[0];
  }

  // Micro mode — no logo rendered at all
  if (layout === "micro") return null;

  // Compact mode — single colourful line: ✦ CODEXA
  if (layout === "compact") {
    const letters = ["C", "O", "D", "E", "X", "A"];
    return (
      <Box>
        <Text color={theme.LOGO[0]} bold>{"✦ "}</Text>
        {letters.map((char, index) => (
          <Text key={index} color={colorForIndex(index)} bold>
            {char}
          </Text>
        ))}
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
