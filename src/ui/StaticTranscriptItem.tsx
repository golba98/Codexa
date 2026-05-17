import { Box } from "ink";
import type { Layout } from "./layout.js";
import type { TimelineItem } from "./Timeline.js";
import { TimelineRowView } from "./Timeline.js";
import { MemoizedTurnGroup, resolveTurnRunPhase } from "./TurnGroup.js";
import { buildStandaloneEventRows } from "./timelineMeasure.js";
import type { RenderTimelineItem } from "./Timeline.js";

interface StaticTranscriptItemProps {
  item: TimelineItem;
  layout: Layout;
  verboseMode: boolean;
  workspaceRoot: string | null;
}

export function StaticTranscriptItem({
  item,
  layout,
  verboseMode,
  workspaceRoot,
}: StaticTranscriptItemProps) {
  if (item.type === "turn") {
    if (!item.user) return null;
    return (
      <MemoizedTurnGroup
        cols={layout.cols}
        turnIndex={item.turnIndex}
        user={item.user}
        run={item.run}
        assistant={item.assistant}
        opacity="active"
        question={null}
        runPhase={resolveTurnRunPhase(item.run, item.assistant, { kind: "IDLE" }, item.turnId)}
        streamPreviewRows={0}
        streamMode="assistant-first"
        verboseMode={verboseMode}
        workspaceRoot={workspaceRoot}
      />
    );
  }

  const renderItem: Extract<RenderTimelineItem, { type: "event" }> = {
    key: `static-event-${item.event.id}`,
    type: "event",
    padded: false,
    event: item.event,
  };
  const rows = buildStandaloneEventRows(renderItem, layout.cols);
  return (
    <Box flexDirection="column">
      {rows.map((row) => (
        <TimelineRowView key={row.key} row={row} />
      ))}
    </Box>
  );
}
