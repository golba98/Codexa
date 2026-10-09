import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTranscriptExport } from "../../session/transcriptExport.js";
import type { TimelineEvent } from "../../session/types.js";
import { buildMarkdownRows } from "../timeline/measure/markdownRows.js";
import type { CodeSegment, ParaSegment, Segment } from "./Markdown.js";
import { isShellCodeLanguage, parseMarkdown } from "./Markdown.js";

const SAMPLE = [
  "# Summary",
  "",
  "The current rendering path is flattening the assistant response into a dense block.",
  "",
  "What needs to improve:",
  "",
  "- Preserve paragraph spacing.",
  "- Keep bullet lists readable.",
  "- Keep code blocks separate.",
  "- Avoid merging activity logs with final answers.",
  "",
  "Steps:",
  "",
  "1. Sanitize unsafe control characters.",
  "2. Preserve markdown structure.",
  "3. Render semantic blocks with spacing.",
  "4. Verify streaming still works.",
  "",
  "Example command:",
  "",
  "```powershell",
  "npm run typecheck",
  "npm run build",
  "```",
  "",
  "Assistant: Done. Formatting pipeline is now applied.",
].join("\n");

function segmentText(segments: Segment[]): string {
  return segments
    .flatMap((segment) => {
      if (segment.type === "code") return segment.lines;
      if (segment.type === "header") return segment.parts.map((part) => part.text);
      if (segment.type === "list")
        return segment.items.flatMap((item) => item.parts.map((part) => part.text));
      if (segment.type === "table")
        return [...segment.headers, ...segment.rows.flat()].flatMap((parts) =>
          parts.map((part) => part.text),
        );
      if (segment.type === "quote") return [segmentText(segment.segments)];
      if (segment.type === "rule") return [];
      return segment.lines.flatMap((line) => line.map((part) => part.text));
    })
    .join("\n");
}

test("sample response produces separate segments, not one dense para", () => {
  const segments = parseMarkdown(SAMPLE);
  const types = segments.map((s) => s.type);

  assert.ok(
    segments.length >= 7,
    `expected ≥7 segments, got ${segments.length}: ${JSON.stringify(types)}`,
  );
  assert.equal(segments[0]?.type, "header", "first segment must be the header");
  assert.ok(types.includes("code"), "expected a code segment");
  assert.ok(types.includes("list"), "expected a list segment");
});

test("blank lines between paragraphs produce separate ParaSegments", () => {
  const segments = parseMarkdown(SAMPLE);
  const paras = segments.filter((s): s is ParaSegment => s.type === "para");

  for (const para of paras) {
    const text = para.lines
      .flat()
      .map((p) => p.text)
      .join(" ");
    assert.ok(
      !(text.includes("rendering path") && text.includes("What needs to improve")),
      "two distinct paragraphs must not share one ParaSegment",
    );
  }
});

test("blank lines inside code blocks are preserved", () => {
  const input = "```\nline1\n\nline3\n```";
  const segments = parseMarkdown(input);
  assert.equal(segments.length, 1);
  assert.equal(segments[0]?.type, "code");
  const code = segments[0] as CodeSegment;
  assert.deepEqual(code.lines, ["line1", "", "line3"]);
});

test("plain paragraphs with no blank lines stay in one segment", () => {
  const input = "Line one.\nLine two.\nLine three.";
  const segments = parseMarkdown(input);
  assert.equal(segments.length, 1);
  assert.equal(segments[0]?.type, "para");
  const para = segments[0] as ParaSegment;
  assert.equal(para.lines.length, 3);
});

test("header immediately followed by text produces two segments", () => {
  const input = "# Title\n\nSome text here.";
  const segments = parseMarkdown(input);
  assert.equal(segments[0]?.type, "header");
  assert.equal(segments[1]?.type, "para");
});

test("preserves local link targets while displaying their labels", () => {
  const input =
    "The app shell lives in [`src/App.tsx`](C:/Users/Example/Projects/Project/src/App.tsx#L22).";
  const text = segmentText(parseMarkdown(input));

  assert.match(text, /src\/App\.tsx/);
  assert.match(text, /C:\/Users/);
  assert.doesNotMatch(text, /\]\(/);
});

test("preserves Windows absolute paths in prose", () => {
  const input = "Formal proof: C:\\Users\\Example\\Projects\\Project\\docs\\proof.md#L26";
  const text = segmentText(parseMarkdown(input));

  assert.match(text, /proof\.md#L26/);
  assert.match(text, /C:\\Users/);
});

test("preserves file targets with encoded spaces", () => {
  const input =
    "Overview: [README.md](file:///C:/Users/Example/Projects/5-Date%20Verification/README.md)";
  const text = segmentText(parseMarkdown(input));

  assert.match(text, /README\.md/);
  assert.match(text, /file:\/\//);
  assert.match(text, /5-Date%20Verification/);
});

test("preserves local line ranges", () => {
  const input = "See [proof](C:/Users/Example/Projects/Project/docs/proof.md#L26-L31).";
  const text = segmentText(parseMarkdown(input));

  assert.match(text, /proof/);
  assert.match(text, /#L26-L31/);
  assert.match(text, /C:\/Users/);
});

test("external web links show labels and their complete targets", () => {
  const input = "Docs: [OpenAI](https://platform.openai.com/docs).";
  const text = segmentText(parseMarkdown(input));

  assert.match(text, /OpenAI/);
  assert.match(text, /https:\/\/platform\.openai\.com\/docs/);
  assert.doesNotMatch(text, /\[OpenAI\]/);
});

test("inline-code web links remain unchanged", () => {
  const input = "Use `https://platform.openai.com/docs` for reference.";
  const text = segmentText(parseMarkdown(input));

  assert.match(text, /https:\/\/platform\.openai\.com\/docs/);
});

test("code blocks are not rewritten by terminal answer cleanup", () => {
  const input = [
    "```text",
    "C:/Users/Example/Project/src/App.tsx#L22",
    "[README.md](file:///C:/Project/README.md)",
    "```",
  ].join("\n");
  const segments = parseMarkdown(input);
  const code = segments[0] as CodeSegment;

  assert.deepEqual(code.lines, [
    "C:/Users/Example/Project/src/App.tsx#L22",
    "[README.md](file:///C:/Project/README.md)",
  ]);
});

test("recognizes executable shell fence languages without treating ordinary code as shell", () => {
  for (const language of [
    "bash",
    "sh",
    "shell",
    "zsh",
    "fish",
    "powershell",
    "pwsh",
    "cmd",
    "bat",
    "batch",
  ]) {
    assert.equal(isShellCodeLanguage(language), true);
  }
  assert.equal(isShellCodeLanguage("typescript"), false);
});

test("rich rendering preserves original Markdown for the existing transcript copy workflow", () => {
  const raw =
    "# Summary\n\n| A | B |\n|---|---|\n| **value** | `x|y` |\n\n```ts\n\tC:/Users/Example/src/file.ts#L2  \n\n\nconst n = 1;\n```";
  const events: TimelineEvent[] = [
    { id: 1, type: "user", createdAt: 1, prompt: "raw export", turnId: 1 },
    { id: 2, type: "assistant", createdAt: 2, content: raw, contentChunks: [], turnId: 1 },
  ];
  buildMarkdownRows(parseMarkdown(raw), 40);
  assert.equal(buildTranscriptExport(events)?.transcript, `You: raw export\n\nUbume: ${raw}`);
  if (events[1]?.type === "assistant") assert.equal(events[1].content, raw);
});
