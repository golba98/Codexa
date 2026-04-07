import React from "react";
import { Box, Text } from "ink";
import { getUsableShellWidth } from "./layout.js";
import { wrapPlainText } from "./textLayout.js";
import { useTheme } from "./theme.js";
import { Section } from "./Section.js";

interface ActionRequiredBlockProps {
  cols: number;
  turnIndex: number;
  question: string;
}

export function ActionRequiredBlock({ cols, turnIndex, question }: ActionRequiredBlockProps) {
  const theme = useTheme();
  const sectionCols = Math.max(1, getUsableShellWidth(cols, 2));
  const contentWidth = Math.max(1, sectionCols - 4);

  const wrappedContent = question
    .split("\n")
    .flatMap((line) => {
      const rows = wrapPlainText(line, contentWidth);
      return rows.length > 0 ? rows : [""];
    });

  return (
    <Box flexDirection="column" marginBottom={1} width="100%">
      <Section
        cols={sectionCols}
        title={`[${turnIndex}] ACTION REQUIRED`}
        rightBadge="⚡"
        borderColor={theme.WARNING}
        titleColor={theme.WARNING}
        badgeColor={theme.WARNING}
        variant="boxed"
      >
        <Box flexDirection="column" width="100%">
          <Text color={theme.TEXT} bold>{"Verification Question"}</Text>
          {wrappedContent.map((row, index) => (
            <Text key={`content-${index}`} color={theme.TEXT}>{row || " "}</Text>
          ))}
        </Box>
      </Section>
    </Box>
  );
}
