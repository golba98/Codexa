import type { TimelineEvent } from "./types.js";
import { getRunPlanText } from "./types.js";

export function hasFinalizedTranscriptPlan(events: readonly TimelineEvent[], planText: string | null | undefined): boolean {
  const expected = planText?.trim() ?? "";
  if (!expected) return false;

  return events.some((event) => {
    if (event.type !== "run") return false;
    if (event.status !== "completed") return false;
    if (event.plan?.status !== "completed") return false;
    const transcriptPlan = getRunPlanText(event.plan).trim();
    return transcriptPlan.length > 0 && transcriptPlan === expected;
  });
}
