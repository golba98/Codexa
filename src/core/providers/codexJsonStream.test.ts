import assert from "node:assert/strict";
import test from "node:test";
import type { RunToolActivity } from "../../session/types.js";
import { createCodexJsonStreamParser } from "./codexJsonStream.js";

test("streams incremental agent_message growth as assistant deltas", () => {
  const assistant: string[] = [];
  const parser = createCodexJsonStreamParser({
    onAssistantDelta: (chunk) => assistant.push(chunk),
  });

  assert.equal(parser.feedLine(JSON.stringify({
    type: "item.started",
    item: { id: "msg-1", type: "agent_message", text: "Hello" },
  })), true);
  assert.equal(parser.feedLine(JSON.stringify({
    type: "item.updated",
    item: { id: "msg-1", type: "agent_message", text: "Hello world" },
  })), true);
  assert.equal(parser.feedLine(JSON.stringify({
    type: "item.completed",
    item: { id: "msg-1", type: "agent_message", text: "Hello world!" },
  })), true);

  assert.deepEqual(assistant, ["Hello", " world", "!"]);
  assert.equal(parser.getFinalResponse(), "Hello world!");
});

test("surfaces command execution lifecycle as tool activity", () => {
  const toolActivities: RunToolActivity[] = [];
  const parser = createCodexJsonStreamParser({
    onToolActivity: (activity) => toolActivities.push(activity),
  });

  parser.feedLine(JSON.stringify({
    type: "item.started",
    item: {
      id: "cmd-1",
      type: "command_execution",
      command: "rg --files",
      status: "in_progress",
      aggregated_output: "",
    },
  }));
  parser.feedLine(JSON.stringify({
    type: "item.completed",
    item: {
      id: "cmd-1",
      type: "command_execution",
      command: "rg --files",
      status: "completed",
      aggregated_output: "src/app.tsx\nsrc/ui/Timeline.tsx\n",
      exit_code: 0,
    },
  }));

  assert.equal(toolActivities.length, 2);
  assert.equal(toolActivities[0]?.status, "running");
  assert.equal(toolActivities[0]?.command, "rg --files");
  assert.equal(toolActivities[1]?.status, "completed");
  assert.match(toolActivities[1]?.summary ?? "", /src\/app\.tsx/i);
});

test("emits progress updates for todo_list and reasoning items", () => {
  const progress: string[] = [];
  const parser = createCodexJsonStreamParser({
    onProgress: (line) => progress.push(line),
  });

  parser.feedLine(JSON.stringify({
    type: "item.updated",
    item: {
      id: "todo-1",
      type: "todo_list",
      items: [
        { text: "Inspect workspace", completed: true },
        { text: "Write file", completed: false },
      ],
    },
  }));
  parser.feedLine(JSON.stringify({
    type: "item.updated",
    item: {
      id: "reason-1",
      type: "reasoning",
      text: "Verifying the generated output",
    },
  }));

  assert.deepEqual(progress, [
    "Todo 1/2: Write file",
    "Verifying the generated output",
  ]);
});

test("captures turn failures from structured events", () => {
  const parser = createCodexJsonStreamParser({});

  parser.feedLine(JSON.stringify({
    type: "turn.failed",
    error: { message: "Permission denied" },
  }));

  assert.equal(parser.getFailureMessage(), "Permission denied");
});

test("returns false for non-json lines so callers can fall back to transcript parsing", () => {
  const parser = createCodexJsonStreamParser({});

  assert.equal(parser.feedLine("assistant"), false);
  assert.equal(parser.hasStructuredEvents(), false);
});
