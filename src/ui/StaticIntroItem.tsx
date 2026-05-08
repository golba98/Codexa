import React from "react";
import { Box } from "ink";
import type { CodexAuthState } from "../core/auth/codexAuth.js";
import { getShellWidth, type Layout } from "./layout.js";
import { buildIntroRenderItem, TimelineRowView } from "./Timeline.js";
import type { TimelineRow } from "./timelineMeasure.js";
import { buildTimelineSnapshot } from "./timelineMeasure.js";

interface StaticIntroItemProps {
  authState: CodexAuthState;
  workspaceLabel: string;
  layout: Layout;
  verboseMode: boolean;
  workspaceRoot: string | null;
}

export function buildStaticIntroRows({
  authState,
  workspaceLabel,
  layout,
  verboseMode,
  workspaceRoot,
}: StaticIntroItemProps): TimelineRow[] {
  const introItem = buildIntroRenderItem({ authState, workspaceLabel, layout });
  return buildTimelineSnapshot([introItem], {
    totalWidth: getShellWidth(layout.cols),
    verboseMode,
    debugLabel: "static-intro",
    workspaceRoot,
  }).rows;
}

export function StaticIntroItem(props: StaticIntroItemProps) {
  const rows = React.useMemo(() => buildStaticIntroRows(props), [
    props.authState,
    props.workspaceLabel,
    props.layout.cols,
    props.layout.rows,
    props.layout.mode,
    props.verboseMode,
    props.workspaceRoot,
  ]);

  return (
    <Box flexDirection="column">
      {rows.map((row) => (
        <TimelineRowView key={row.key} row={row} />
      ))}
    </Box>
  );
}
