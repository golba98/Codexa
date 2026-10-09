import { runCommand } from "../process/commandRunner.js";
import { buildSpawnSpec } from "./executableResolver.js";

/** Check the AGY interface without submitting a prompt or touching authentication. */
export async function verifyAgyExecutable(
  executable: string,
  options: {
    cwd: string;
    signal?: AbortSignal;
    platform?: NodeJS.Platform;
    runCommandImpl?: typeof runCommand;
  },
): Promise<void> {
  if (/^gemini(?:\.(?:exe|cmd|bat))?$/i.test(executable.split(/[\\/]/).at(-1) ?? ""))
    throw new Error("Google requires Antigravity (agy), not the removed Gemini CLI.");
  const probe = (options.runCommandImpl ?? runCommand)({
    ...buildSpawnSpec(executable, ["--help"], options.platform),
    cwd: options.cwd,
    timeoutMs: 10_000,
    signal: options.signal,
  });
  const result = await probe.result;
  await probe.stopped;
  const help = `${result.stdout}\n${result.stderr}`;
  if (
    result.status !== "completed" ||
    result.exitCode !== 0 ||
    !/--model\b/.test(help) ||
    !/--conversation\b/.test(help) ||
    !/(?:--print\b|(?:^|\s)-p\b)/m.test(help)
  )
    throw new Error(
      result.status === "spawn_error"
        ? result.userMessage
        : "The configured Google executable does not expose the Antigravity CLI interface. Configure agy, not Gemini CLI.",
    );
}
