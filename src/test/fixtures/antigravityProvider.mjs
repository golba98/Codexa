#!/usr/bin/env node
// A deterministic AGY process fixture, never a production backend.
import { appendFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
if (args.includes("--help")) {
  console.error("Usage of agy: --model --conversation --print --effort");
} else if (args[0] === "models") {
  console.log(
    "gemini-fixture-high\tGemini Fixture (High)\ngemini-fixture-low\tGemini Fixture (Low)\nclaude-fixture\tClaude Fixture",
  );
} else if (args.includes("-p") && value("-p") === "/effort") {
  console.log(JSON.stringify({ command: { name: "effort", data: { adjustable: false } } }));
} else if (args.includes("-p")) {
  const prompt = value("-p");
  appendFileSync(
    process.env.UBUME_TEST_AGY_LOG,
    `${JSON.stringify({ args, cwd: process.cwd() })}\n`,
  );
  if (prompt.includes("WAIT_FOR_INTERRUPT")) {
    writeFileSync(process.env.UBUME_TEST_PID_FILE, `${process.pid}`);
    setInterval(() => {}, 1000);
  } else if (prompt.includes("AUTH_FAILURE")) {
    console.error("Antigravity authentication expired; sign in with agy.");
    process.exitCode = 1;
  } else {
    console.log(`AGY_REPLY:${value("--model")}`);
  }
} else {
  console.error("Unexpected fixture arguments");
  process.exitCode = 2;
}
