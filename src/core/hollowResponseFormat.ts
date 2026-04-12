import type { HollowResponseResult } from "./codexPrompt.js";

const MESSAGES: Record<string, [string, string]> = {
  greeting: [
    "Task not executed — backend returned a generic greeting.",
    "Retry with a more specific instruction.",
  ],
  filler: [
    "Task not executed — backend acknowledged without acting.",
    "Retry with a more specific instruction.",
  ],
  clarification: [
    "Task not executed — backend asked for clarification instead of acting.",
    "Rephrase with more detail, or switch to suggest mode.",
  ],
  "short-no-action": [
    "No action confirmed — response too brief for a write-intent prompt.",
    "Verify workspace files manually, or retry.",
  ],
};

export function formatHollowResponse(
  result: HollowResponseResult,
  rawResponse?: string,
  verbose?: boolean,
): string {
  const lines = MESSAGES[result.kind] ?? [
    "Task not executed — unexpected backend response.",
    "Retry with a more specific instruction.",
  ];

  let output = lines.join("\n");

  if (verbose && rawResponse) {
    output += `\n\nBackend response: ${rawResponse}`;
  }

  return output;
}
