import { Box, Text } from "ink";
import React, { useMemo } from "react";
import { useTheme } from "../theme.js";
import { buildMarkdownRows } from "../timeline/measure/markdownRows.js";
import { createRow } from "../timeline/measure/rows.js";
import { TimelineRowView } from "../timeline/TimelineRows.js";
import type { Segment } from "./markdownParser.js";

export type {
  CodeSegment,
  HeaderSegment,
  ListSegment,
  ParaSegment,
  Segment,
} from "./markdownParser.js";
export { isShellCodeLanguage, parseMarkdown } from "./markdownParser.js";

function RenderMessage({
  segments,
  width,
  brightHeadings = false,
}: {
  segments: Segment[];
  width: number;
  brightHeadings?: boolean;
}) {
  const rows = useMemo(
    () =>
      buildMarkdownRows(segments, width, { brightHeadings }).map((spans, index) =>
        createRow(`markdown-${index}`, spans, width),
      ),
    [segments, width, brightHeadings],
  );
  return (
    <Box flexDirection="column" width="100%">
      {rows.map((row) => (
        <TimelineRowView key={row.key} row={row} />
      ))}
    </Box>
  );
}
export const MemoizedRenderMessage = React.memo(RenderMessage);

interface PanelProps {
  cols: number;
  title: string;
  rightTitle?: string;
  borderColor?: string;
  titleColor?: string;
  children: React.ReactNode;
}

export function Panel({ cols, title, rightTitle, borderColor, titleColor, children }: PanelProps) {
  const theme = useTheme();
  const cBorder = borderColor || theme.borderFocused;
  const cTitle = titleColor || theme.text;

  const leftLabel = ` ${title} `;
  const rightLabel = rightTitle ? ` ${rightTitle} ` : "";

  // ╭─ TITLE ─── RIGHTTITLE ╮
  // Calculate remaining dashes
  // total length = 2 (╭─) + leftLabel + dashes + rightLabel + 1 (╮) = cols
  // dashes = cols - 3 - leftLabel.length - rightLabel.length
  const maxDashes = cols - 3 - leftLabel.length - rightLabel.length;
  const dashCount = Math.max(0, maxDashes);

  return (
    <Box flexDirection="column" width={cols} overflow="hidden">
      <Text color={cBorder}>
        {"╭─"}
        <Text color={cTitle}>{leftLabel}</Text>
        {"─".repeat(dashCount)}
        {rightTitle && <Text color={theme.textDim}>{rightLabel}</Text>}
        {"╮"}
      </Text>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderTop={false}
        borderColor={cBorder}
        width={cols}
        paddingX={1}
        paddingY={0}
      >
        {children}
      </Box>
    </Box>
  );
}
