#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("fake-provider 1.0");
  process.exit(0);
}
if (args[0] === "login" || args[0] === "auth") {
  console.log('{"loggedIn":true}');
  process.exit(0);
}
if (args.includes("-p")) {
  if (process.env.UBUME_TEST_PROMPT_LOG)
    appendFileSync(process.env.UBUME_TEST_PROMPT_LOG, JSON.stringify(args.at(-1)) + "\n");
  console.log(
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "anthropic fixture answer" }] },
    }),
  );
  process.exit(0);
}
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
if (process.env.UBUME_TEST_PROMPT_LOG)
  appendFileSync(process.env.UBUME_TEST_PROMPT_LOG, JSON.stringify(prompt) + "\n");
const event = (type, item) => console.log(JSON.stringify({ type, item }));
if (prompt.includes("WAIT_FOR_INTERRUPT")) {
  event("item.started", { id: "answer", type: "agent_message", text: "partial reply" });
  if (process.env.UBUME_TEST_PID_FILE)
    writeFileSync(process.env.UBUME_TEST_PID_FILE, String(process.pid));
  setInterval(() => {}, 1000);
} else {
  if (prompt.includes("CHANGE_FILE")) writeFileSync("demo.ts", "export const result = 1;\n");
  event("item.completed", {
    id: "tool",
    type: "command_execution",
    command: "echo fixture",
    status: "completed",
    aggregated_output: "fixture output",
    exit_code: 0,
  });
  const text = "fixture final answer";
  event("item.started", { id: "answer", type: "agent_message", text: text.slice(0, 7) });
  event("item.completed", { id: "answer", type: "agent_message", text });
  event("turn.completed");
}
