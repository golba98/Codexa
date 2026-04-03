import React from "react";
import { Box, Text } from "ink";
import { getUsableShellWidth } from "./layout.js";
import { wrapPlainText } from "./textLayout.js";
import { useTheme } from "./theme.js";

interface ActionRequiredBlockProps {
  cols: number;
  turnIndex: number;
  question: string;
}

export function ActionRequiredBlock({ cols, turnIndex, question }: ActionRequiredBlockProps) {
  const theme = useTheme();
  const contentWidth = Math.max(1, getUsableShellWidth(cols, 6));

  const wrappedContent = question
    .split("\n")
    .flatMap((line) => {
      const rows = wrapPlainText(line, contentWidth);
      return rows.length > 0 ? rows : [""];
    });

  return (
    <Box borderStyle="single" borderColor={theme.BORDER_ACTIVE} flexDirection="column" marginBottom={1} width="100%">
      <Box width="100%" justifyContent="space-between" overflow="hidden" paddingX={1}>
        <Text color={theme.TEXT} bold>{`[${turnIndex}] ACTION REQUIRED`}</Text>
        <Text color={theme.TEXT} bold>{"⚡"}</Text>
      </Box>
      <Box flexDirection="column" paddingX={2} marginTop={1} marginBottom={1} width="100%">
        <Text color={theme.TEXT} bold>{"Verification Question"}</Text>
        {wrappedContent.map((row, index) => (
          <Text key={`content-${index}`} color={theme.TEXT}>{row || " "}</Text>
        ))}
      </Box>
    </Box>
  );
}
