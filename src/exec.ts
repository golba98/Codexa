import { parseHeadlessExecArgs } from "./headless/execArgs.js";
import {
  HEADLESS_EXEC_PARSE_ERROR,
  runHeadlessExec,
} from "./headless/execRunner.js";

export function printExecHelp(): void {
  console.log(`Usage:
  codexa exec "prompt"
  codexa exec --prompt "prompt"
  codexa exec [--profile <name>] [-c key=value] "prompt"

Options:
      --prompt <text>     Prompt to submit in headless mode.
      --profile <name>    Load a Codex profile from config.
  -c, --config <key=val>  Override a runtime config value.
  -h, --help              Show this help text and exit.
`);
}

const isMainModule = Boolean((import.meta as ImportMeta & { main?: boolean }).main);

if (isMainModule) {
  const parsed = parseHeadlessExecArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`[codexa exec] parse: ${parsed.error}`);
    process.exit(HEADLESS_EXEC_PARSE_ERROR);
  }

  if (parsed.value.help) {
    printExecHelp();
    process.exit(0);
  }

  const result = await runHeadlessExec({
    prompt: parsed.value.prompt,
    launchArgs: parsed.value.launchArgs,
  });
  process.exit(result.exitCode);
}
