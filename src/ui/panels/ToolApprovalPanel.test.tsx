import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { render } from "ink";
import { ThemeProvider } from "../theme.js";
import { ToolApprovalPanel } from "./ToolApprovalPanel.js";

class Input extends PassThrough {
  readonly isTTY = true;
  setRawMode() {
    return this;
  }
  ref() {
    return this;
  }
  unref() {
    return this;
  }
}
class Output extends PassThrough {
  readonly isTTY = true;
  columns = 110;
  rows = 24;
}

test("browser approval renders a concise target and offers only individual approval or denial", async () => {
  const stdin = new Input();
  const stdout = new Output();
  let output = "";
  stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  const decisions: string[] = [];
  const instance = render(
    <ThemeProvider>
      <ToolApprovalPanel
        focusId="browser-permission"
        request={{
          tool: "browser_type",
          signature: "browser:1",
          paths: [],
          description: "Browser  Type e7 — Email field",
          allowForRun: false,
        }}
        onSelect={(decision) => decisions.push(decision)}
      />
    </ThemeProvider>,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.match(output, /Browser  Type e7/);
    assert.match(output, /Allow once/);
    assert.match(output, /Deny/);
    assert.doesNotMatch(output, /matching action/);
    stdin.write("j");
    await new Promise((resolve) => setTimeout(resolve, 30));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(decisions, ["deny"]);
  } finally {
    instance.cleanup();
  }
});
