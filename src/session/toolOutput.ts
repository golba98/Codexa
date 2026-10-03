import type { RunToolActivity } from "./types.js";
export const TOOL_OUTPUT_BYTES = 256 * 1024;
const TURN_OUTPUT_BYTES = 8 * 1024 * 1024;
export class ToolOutputBudget {
  private sizes = new Map<string, number>();
  bound(activity: RunToolActivity): RunToolActivity {
    if (activity.output === undefined) return activity;
    const occupied = [...this.sizes].reduce(
      (total, [id, bytes]) => total + (id === activity.id ? 0 : bytes),
      0,
    );
    const cap = Math.max(0, Math.min(TOOL_OUTPUT_BYTES, TURN_OUTPUT_BYTES - occupied));
    const bytes = Buffer.from(activity.output);
    const output =
      bytes.length <= cap
        ? activity.output
        : new TextDecoder().decode(bytes.subarray(0, cap), { stream: true });
    this.sizes.set(activity.id, Buffer.byteLength(output));
    return { ...activity, output, outputTruncated: activity.outputTruncated || bytes.length > cap };
  }
}
