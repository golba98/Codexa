import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { render } from "ink";
import { ThemeProvider } from "../theme.js";
import { AnimatedStatusText } from "./AnimatedStatusText.js";

class TestInput extends PassThrough {
  readonly isTTY = true;

  setRawMode(): this {
    return this;
  }

  override resume(): this {
    return this;
  }

  override pause(): this {
    return this;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }
}

class TestOutput extends PassThrough {
  readonly isTTY = true;
  columns = 120;
  rows = 40;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function sleep(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const here = dirname(fileURLToPath(import.meta.url));

test("busy status text owns the local animation timer", () => {
  const source = readFileSync(join(here, "AnimatedStatusText.tsx"), "utf8");

  assert.match(source, /setInterval/);
  assert.match(source, /useEffect/);
  assert.match(source, /useState/);
  assert.doesNotMatch(source, /useAnimatedDots|useThrottledValue/);
});

function StatusHarness({ showBusyLoader = true }: { showBusyLoader?: boolean }) {
  return (
    <ThemeProvider theme="purple">
      <AnimatedStatusText baseText="Ubume is thinking" isActive={showBusyLoader} />
    </ThemeProvider>
  );
}

test("busy status advances from local state without a parent rerender", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let output = "";

  stdout.on("data", (chunk) => {
    output += chunk.toString();
  });

  const instance = render(<StatusHarness />, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    exitOnCtrlC: false,
  });

  await sleep();
  let frame = stripAnsi(output);
  assert.match(frame, /Ubume is thinking \./);

  output = "";
  await sleep(950);
  frame = stripAnsi(output);
  assert.match(frame, /Ubume is thinking \.\./);

  instance.unmount();
});

test("busy status omits loader frames when inactive", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let output = "";

  stdout.on("data", (chunk) => {
    output += chunk.toString();
  });

  const instance = render(<StatusHarness showBusyLoader={false} />, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    exitOnCtrlC: false,
  });

  try {
    await sleep();
    let frame = stripAnsi(output);
    assert.match(frame, /Ubume is thinking/);
    assert.doesNotMatch(frame, /Ubume is thinking \./);

    output = "";
    await sleep(950);
    frame = stripAnsi(output);
    assert.equal(frame, "");
  } finally {
    instance.unmount();
  }
});

test("static status debug flag reserves status text without dot ticks", async () => {
  const previous = process.env.UBUME_DEBUG_STATIC_STATUS;
  process.env.UBUME_DEBUG_STATIC_STATUS = "1";
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let output = "";

  stdout.on("data", (chunk) => {
    output += chunk.toString();
  });

  const instance = render(<StatusHarness />, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    exitOnCtrlC: false,
  });

  try {
    await sleep();
    let frame = stripAnsi(output);
    assert.match(frame, /Ubume is thinking \.\.\./);

    output = "";
    await sleep(950);
    frame = stripAnsi(output);
    assert.equal(frame, "");
  } finally {
    instance.unmount();
    if (previous === undefined) {
      delete process.env.UBUME_DEBUG_STATIC_STATUS;
    } else {
      process.env.UBUME_DEBUG_STATIC_STATUS = previous;
    }
  }
});
