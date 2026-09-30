import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { PassThrough } from "node:stream";
import { render, renderToString } from "ink";
import { getVisualWidth, PanelLayoutContext } from "../layout.js";
import { createAtomicContentToken } from "../input/pastedContent.js";
import { ThemeProvider } from "../theme.js";
import { ResumePicker } from "./ResumePicker.js";

class TestInput extends PassThrough {
  readonly isTTY = true;
  setRawMode(): this { return this; }
  override resume(): this { return this; }
  override pause(): this { return this; }
  ref(): this { return this; }
  unref(): this { return this; }
}

class TestOutput extends PassThrough {
  readonly isTTY = true;
  columns = 100;
  rows = 22;
}

function sleep(ms = 60): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("ResumePicker keeps its side borders aligned for pasted titles at different widths", () => {
  const conversations = [{
    version: 1 as const,
    id: "chat_paste",
    title: createAtomicContentToken("[Pasted Content 22,703 chars]"),
    createdAt: "",
    updatedAt: "not a date",
    providerId: "local",
    modelId: "Ornith-1.5-35B-A3B-Q4_K_M",
    backendKind: null,
    messageCount: 9,
  }];
  for (const columns of [60, 80, 100, 120]) {
    const frame = renderToString(
      <ThemeProvider theme="purple">
        <PanelLayoutContext.Provider value={{ mode: "compact", availableRows: 12, availableCols: columns - 4 }}>
          <ResumePicker conversations={conversations} onSelect={() => {}} onCancel={() => {}} loadExternalSessions={async () => []} />
        </PanelLayoutContext.Provider>
      </ThemeProvider>,
      { columns },
    );
    const lines = frame.split("\n");
    assert.equal(lines.length, 5);
    assert.match(frame, /\[Pasted Content 22,703 chars\]/);
    assert.doesNotMatch(frame, /\u2063[\uFE00-\uFE09]+\u2063/);
    for (const line of lines) assert.equal(getVisualWidth(line), columns, `misaligned border at ${columns} columns: ${line}`);
    for (const line of lines.slice(1, -1)) {
      assert.ok(line.startsWith("│ "));
      assert.ok(line.endsWith(" │"));
    }
  }
});

test("ResumePicker lists metadata and resumes the selected conversation", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let output = "";
  stdout.on("data", (chunk) => { output += chunk.toString(); });
  let selected: string | null = null;
  const instance = render(
    <ThemeProvider theme="purple">
      <PanelLayoutContext.Provider value={{ mode: "compact", availableRows: 12, availableCols: 96 }}>
        <ResumePicker
          conversations={[{
            version: 1,
            id: "chat_one",
            title: "Fix provider picker",
            createdAt: "2026-08-16T10:00:00.000Z",
            updatedAt: "2026-08-16T10:00:00.000Z",
            providerId: "local",
            modelId: "qwen",
            backendKind: "local-openai-compatible",
            messageCount: 4,
          }]}
          onSelect={(id) => { selected = id; }}
          onCancel={() => {}}
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
  try {
    await sleep();
    const text = output.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
    assert.match(text, /Fix provider picker/);
    assert.match(text, /qwen/);
    stdin.write("\r");
    await sleep();
    assert.equal(selected, "chat_one");
  } finally {
    instance.cleanup();
    await sleep(20);
  }
});

type PickerProps = React.ComponentProps<typeof ResumePicker>;

function mountPicker(props: Partial<PickerProps>) {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let output = "";
  stdout.on("data", (chunk) => { output += chunk.toString(); });
  const instance = render(
    <ThemeProvider theme="purple">
      <PanelLayoutContext.Provider value={{ mode: "compact", availableRows: 12, availableCols: 96 }}>
        <ResumePicker conversations={[]} onSelect={() => {}} onCancel={() => {}} {...props} />
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
    // Debug mode appends every frame; the last frame is what is on screen.
    lastFrame: () => {
      const text = output.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
      return text.slice(text.lastIndexOf("Resume"));
    },
    cleanup: async () => { instance.cleanup(); await sleep(20); },
  };
}

const RIGHT = "\u001B[C";
const here = { source: "claude" as const, id: "here-1", title: "Fix flaky test", cwd: "/work/app", updatedAt: "2026-09-30T10:00:00.000Z", model: "claude-opus-5-5" };
const elsewhere = { source: "claude" as const, id: "far-2", title: "Movie app subtitles", cwd: "/work/movies", updatedAt: "2026-09-30T11:00:00.000Z" };

test("ResumePicker browses native CLI sessions by folder, then every project", async () => {
  const calls: string[] = [];
  const opened: string[] = [];
  const picker = mountPicker({
    loadExternalSessions: async (source, scope) => { calls.push(`${source}:${scope}`); return scope === "all" ? [elsewhere, here] : [here]; },
    onOpenExternal: (summary) => opened.push(`view:${summary.id}`),
    onResumeExternalNative: (summary) => opened.push(`native:${summary.id}`),
    onContinueExternal: (summary) => opened.push(`continue:${summary.id}`),
  });
  try {
    await sleep();
    assert.match(picker.lastFrame(), /Ubume.*Claude Code.*Codex.*Antigravity/);
    picker.stdin.write(RIGHT);
    await sleep();
    assert.deepEqual(calls, ["claude:workspace"]);
    assert.match(picker.lastFrame(), /This folder/);
    assert.match(picker.lastFrame(), /Fix flaky test — .*claude-opus-5-5/);
    assert.doesNotMatch(picker.lastFrame(), /Movie app subtitles/);

    picker.stdin.write("a");
    await sleep();
    assert.deepEqual(calls, ["claude:workspace", "claude:all"]);
    assert.match(picker.lastFrame(), /All projects/);
    assert.match(picker.lastFrame(), /Movie app subtitles — .*movies/);

    picker.stdin.write("\r"); await sleep();
    picker.stdin.write("o"); await sleep();
    picker.stdin.write("j"); await sleep();
    picker.stdin.write("c"); await sleep();
    assert.deepEqual(opened, ["view:far-2", "native:far-2", "continue:here-1"]);
  } finally {
    await picker.cleanup();
  }
});

test("ResumePicker shows loading, empty and error states for native sections", async () => {
  let finish!: (value: never[]) => void;
  const picker = mountPicker({
    loadExternalSessions: (source) => source === "codex"
      ? new Promise((resolve) => { finish = resolve; })
      : Promise.reject(new Error("store locked")),
  });
  try {
    await sleep();
    picker.stdin.write("3");
    await sleep();
    assert.match(picker.lastFrame(), /Loading Codex sessions/);
    finish([]);
    await sleep();
    assert.match(picker.lastFrame(), /No Codex sessions in this folder — press a for all projects/);
    picker.stdin.write(RIGHT);
    await sleep();
    assert.match(picker.lastFrame(), /Could not read Antigravity sessions: store locked/);
  } finally {
    await picker.cleanup();
  }
});

test("ResumePicker restores its section, scope and selection and reports changes", async () => {
  const positions: string[] = [];
  let opened: string | null = null;
  const picker = mountPicker({
    position: { tab: "claude", scope: "all", selectedId: "here-1" },
    loadExternalSessions: async () => [elsewhere, here],
    onOpenExternal: (summary) => { opened = summary.id; },
    onPositionChange: (position) => positions.push(`${position.tab}:${position.scope}:${position.selectedId}`),
  });
  try {
    await sleep();
    picker.stdin.write("\r");
    await sleep();
    assert.equal(opened, "here-1");
    assert.equal(positions.at(-1), "claude:all:here-1");
  } finally {
    await picker.cleanup();
  }
});
