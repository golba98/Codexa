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
  const contentWidth = Math.max(1, getUsableShellWidth(cols, 4));

  // First line treated as a bold title if there are multiple lines, or the
  // question has no trailing "?" on the first line (it's a header, not the question).
  const lines = question.split("\n").filter(Boolean);
  const hasTitle = lines.length > 1 || (lines[0] && !lines[0].trimEnd().endsWith("?"));
  const titleLine = hasTitle ? lines[0] : null;
  const contentLines = hasTitle ? lines.slice(1) : lines;
  const wrappedTitle = titleLine ? wrapPlainText(titleLine, contentWidth) : [];
  const wrappedContent = contentLines.flatMap((line) => {
    const rows = wrapPlainText(line, contentWidth);
    return rows.length > 0 ? rows : [""];
  });

  return (
    <Box flexDirection="column" marginBottom={1} width="100%">
      <Box width="100%" overflow="hidden">
        <Text color={theme.WARNING} bold>{"⚡ "}</Text>
        <Text color={theme.WARNING} bold>{"Action required"}</Text>
      </Box>
      <Box flexDirection="column" paddingLeft={2} marginTop={1} width="100%">
        {wrappedTitle.map((row, index) => (
          <Text key={`title-${index}`} color={theme.TEXT} bold>{row || " "}</Text>
        ))}
        {wrappedContent.map((row, index) => (
          <Text key={`content-${index}`} color={theme.TEXT}>{row || " "}</Text>
        ))}
      </Box>
    </Box>
  );
}
