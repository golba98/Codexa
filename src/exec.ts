import "./legacyEnvBootstrap.js";
import { runTerminalCommand, terminalHelp } from "./headless/commands.js";

export function printExecHelp(): void { process.stdout.write(terminalHelp); }
if ((import.meta as ImportMeta & { main?: boolean }).main) {
  const controller = new AbortController();
  const interrupt = () => { controller.abort(); if (!process.stdin.isTTY) process.stdin.destroy(); };
  process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  try { process.exitCode = await runTerminalCommand(["exec", ...process.argv.slice(2)], undefined, { signal: controller.signal }); }
  finally { process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt); }
}
