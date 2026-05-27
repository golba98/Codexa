import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "./theme.js";
import type { LayoutMode } from "./layout.js";
import { LOGO_MEDIUM } from "./logoVariants.js";

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

  // Full mode — use medium ASCII art. wrap="truncate" prevents Ink from
  // reflowing the fixed-width art across terminal lines.
  return (
    <Box flexDirection="column" overflow="hidden">
      {LOGO_MEDIUM.map((line, index) => (
        <Text key={line} color={colorForIndex(index)} wrap="truncate">
          {line}
        </Text>
      ))}
    </Box>
  );
}
