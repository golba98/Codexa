import { getAssistantContent, type TimelineEvent } from "../../session/types.js";
import { sanitizeTerminalOutput } from "../../core/terminal/terminalSanitize.js";
export interface InspectionEntry { id: string; title: string; details: string }
export function inspectionEntries(events: readonly TimelineEvent[]): InspectionEntry[] {
  return events.flatMap((event): InspectionEntry[] => {
    const time = new Date(event.createdAt).toLocaleTimeString();
    if (event.type === "user") return [{ id: `user-${event.id}`, title: `${time} · Prompt`, details: event.prompt }];
    if (event.type === "assistant") return [{ id: `assistant-${event.id}`, title: `${time} · Answer`, details: getAssistantContent(event) }];
    if (event.type === "run") return [
      { id: `run-${event.id}`, title: `${time} · ${event.runtime.model} · ${event.status}`, details: [event.summary, event.errorMessage, ...event.activity.map((item) => `${item.operation}: ${item.path}`), ...event.progressEntries.map((item) => item.text)].join("\n") },
      ...event.toolActivities.map((tool) => ({ id: `tool-${event.id}-${tool.id}`, title: `${tool.status} · ${tool.command}`, details: [tool.summary, tool.output ?? "Detailed output was not supplied by this provider.", tool.outputTruncated ? "[Output truncated]" : ""].filter(Boolean).join("\n") })),
    ];
    if (event.type === "shell") return [{ id: `shell-${event.id}`, title: `${time} · ${event.status} · ${event.command}`, details: [...event.lines, ...event.stderrLines].join("\n") }];
    return [{ id: `${event.type}-${event.id}`, title: `${time} · ${event.title}`, details: event.content }];
  }).map((entry) => ({ ...entry, title: sanitizeTerminalOutput(entry.title), details: sanitizeTerminalOutput(entry.details) }));
}
