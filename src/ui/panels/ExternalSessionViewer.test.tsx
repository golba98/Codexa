import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { render } from "ink";
import type React from "react";
import type { ExternalTranscript } from "../../core/externalSessions/types.js";
import { PanelLayoutContext } from "../layout.js";
import { ThemeProvider } from "../theme.js";
import { ExternalSessionViewer } from "./ExternalSessionViewer.js";

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
  columns = 100;
  rows = 30;
}

const sleep = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

const summary = {
  source: "claude" as const,
  id: "abc-123",
  title: "Fix flaky test",
  cwd: "/work/app",
  updatedAt: "2026-09-30T10:00:00.000Z",
};
const transcript: ExternalTranscript = {
  summary,
  entries: [
    { id: "e0", kind: "user", title: "You", text: "List the files please" },
    { id: "e1", kind: "tool", title: "Bash · List files", text: "ls -la\n\nsecret-output.txt" },
    { id: "e2", kind: "assistant", title: "Claude", text: "There is one file." },
  ],
};

function mountViewer(props: Partial<React.ComponentProps<typeof ExternalSessionViewer>> = {}) {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let output = "";
  stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  const instance = render(
    <ThemeProvider theme="purple">
      <PanelLayoutContext.Provider
        value={{ mode: "compact", availableRows: 20, availableCols: 96 }}
      >
        <ExternalSessionViewer
          summary={summary}
          loadTranscript={async () => transcript}
          onBack={() => {}}
          onOpenNative={() => {}}
          onContinue={() => {}}
          {...props}
        />
      </PanelLayoutContext.Provider>
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
  return {
    stdin,
    lastFrame: () => {
      const text = output.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
      // Debug mode appends every frame; each frame starts with the panel's top border.
      return text.slice(Math.max(0, text.lastIndexOf("╭")));
    },
    cleanup: async () => {
      instance.cleanup();
      await sleep(20);
    },
  };
}

test("ExternalSessionViewer shows prompts and replies with tool calls collapsed until expanded", async () => {
  const viewer = mountViewer();
  try {
    await sleep();
    let frame = viewer.lastFrame();
    assert.match(frame, /Claude Code · Fix flaky test/);
    assert.match(frame, /\/work\/app/);
    assert.match(frame, /▾ You/);
    assert.match(frame, /List the files please/);
    assert.match(frame, /▸ Bash · List files/);
    assert.doesNotMatch(frame, /secret-output\.txt/);
    assert.match(frame, /There is one file\./);

    viewer.stdin.write("j");
    await sleep();
    viewer.stdin.write("\r");
    await sleep();
    frame = viewer.lastFrame();
    assert.match(frame, /▾ Bash · List files/);
    assert.match(frame, /secret-output\.txt/);

    viewer.stdin.write("e");
    await sleep();
    assert.doesNotMatch(
      viewer.lastFrame(),
      /secret-output\.txt/,
      "e collapses every tool when all are expanded",
    );
  } finally {
    await viewer.cleanup();
  }
});

test("ExternalSessionViewer searches entries and routes o, c and Esc", async () => {
  const calls: string[] = [];
  const viewer = mountViewer({
    onBack: () => calls.push("back"),
    onOpenNative: (target) => calls.push(`native:${target.id}`),
    onContinue: (target) => calls.push(`continue:${target.id}`),
  });
  try {
    await sleep();
    viewer.stdin.write("/");
    await sleep();
    for (const char of "one file") viewer.stdin.write(char);
    await sleep();
    viewer.stdin.write("\r");
    await sleep();
    const frame = viewer.lastFrame();
    assert.match(frame, /There is one file\./);
    assert.doesNotMatch(frame, /List the files please/);

    viewer.stdin.write("o");
    await sleep();
    viewer.stdin.write("c");
    await sleep();
    viewer.stdin.write("\u001B");
    await sleep(120);
    assert.deepEqual(calls, ["native:abc-123", "continue:abc-123", "back"]);
  } finally {
    await viewer.cleanup();
  }
});

test("ExternalSessionViewer shows extraction notices and load failures", async () => {
  const withNotice = mountViewer({
    summary: { ...summary, source: "codex" },
    loadTranscript: async () => ({ ...transcript, notice: "Best-effort extraction." }),
  });
  try {
    await sleep();
    const output = withNotice.lastFrame();
    assert.match(output, /Best-effort extraction\./);
  } finally {
    await withNotice.cleanup();
  }
  const failing = mountViewer({
    loadTranscript: async () => {
      throw new Error("file vanished");
    },
  });
  try {
    await sleep();
    assert.match(failing.lastFrame(), /Could not read this session: file vanished/);
  } finally {
    await failing.cleanup();
  }
});
