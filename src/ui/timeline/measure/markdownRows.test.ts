import assert from "node:assert/strict";
import { test } from "node:test";
import { getTextWidth, splitTextAtColumn } from "../../../core/shared/text.js";
import { parseMarkdown, type Segment } from "../../render/markdownParser.js";
import { resetTimelineMeasureCaches } from "./caches.js";
import { buildMarkdownRows } from "./markdownRows.js";
import { appendSpan, createRow, createSpan, fitSpansToWidth, wrapStyledSpans } from "./rows.js";

const WIDTHS = [40, 60, 80, 100, 120, 160];
const lines = (source: string, width = 80, streaming = false) =>
  buildMarkdownRows(parseMarkdown(source, { streaming }), width).map((row) =>
    row
      .map((span) => span.text)
      .join("")
      .trimEnd(),
  );
const text = (source: string, width = 80) => lines(source, width).join("\n");
const TABLE =
  "| Section | What it explains |\n|---|---|\n| Overview | What Ubume is |\n| Installation | How to install Ubume |\n| Provider setup | Supported providers |\n| Basic usage | Example commands |";

test("two-column response has a clean terminal table snapshot", () => {
  assert.deepEqual(lines(TABLE, 40), [
    "Section         What it explains",
    "──────────────  ────────────────────",
    "Overview        What Ubume is",
    "Installation    How to install Ubume",
    "Provider setup  Supported providers",
    "Basic usage     Example commands",
  ]);
  const rows = buildMarkdownRows(parseMarkdown(TABLE), 40);
  assert.ok(rows[0]?.filter((span) => span.text.trim()).every((span) => span.bold));
  assert.ok(rows[1]?.some((span) => span.tone === "borderSubtle"));
});

test("five columns deliberately stack at 40 columns and form aligned columns at 60", () => {
  const source =
    "|First|Second|Third|Fourth|Fifth|\n|---|---|---|---|---|\n|long text|long text|long text|long text|long text|";
  assert.deepEqual(lines(source, 40), [
    "First: long text",
    "Second: long text",
    "Third: long text",
    "Fourth: long text",
    "Fifth: long text",
  ]);
  assert.equal(lines(source, 60).length, 3);
  assert.doesNotMatch(text(source, 60), /\|/);
});

test("long, empty and Unicode cells keep every value at all required widths", () => {
  const values = [
    "alpha beta gamma delta epsilon",
    "",
    "漢字 日本語 👩🏽‍💻 e\u0301",
    "unbroken".repeat(15),
    "https://example.org/" + "x".repeat(70),
  ];
  const source = `|First|Second|Third|Fourth|Fifth|\n|---|---|---|---|---|\n|${values.join("|")}|`;
  for (const width of WIDTHS) {
    const rows = buildMarkdownRows(parseMarkdown(source), width);
    for (const row of rows)
      assert.ok(
        getTextWidth(row.map((span) => span.text).join("")) <= width,
        `overflow at ${width}`,
      );
    const compact = rows
      .flatMap((row) => row.map((span) => span.text))
      .join("")
      .replace(/\s/g, "");
    const separator = rows[1]?.filter((span) => span.tone === "borderSubtle");
    const reconstructed = separator?.length
      ? separator.map((span, col) => {
          const start = separator
            .slice(0, col)
            .reduce((sum, cell) => sum + getTextWidth(cell.text) + 2, 0);
          return rows
            .slice(2)
            .map((row) => {
              const split = splitTextAtColumn(row.map((part) => part.text).join(""), start);
              return splitTextAtColumn(split.current + split.after, getTextWidth(span.text)).before;
            })
            .join("")
            .replace(/\s/g, "");
        })
      : values.map(() => compact);
    values.forEach((value, col) =>
      assert.ok(
        reconstructed[col]!.includes(value.replace(/\s/g, "")),
        `missing ${value} at ${width}`,
      ),
    );
    assert.ok(compact.includes("👩🏽‍💻"));
    assert.ok(compact.includes("e\u0301"));
  }
});

test("alignment directives apply independently to headers and wrapped cell rows", () => {
  const source = "|Left heading|Center heading|Right heading|\n|:---|:---:|---:|\n|L|C|R|";
  const output = lines(source, 60);
  const header = output[0]!;
  const body = output[2]!;
  assert.equal(body.indexOf("L"), header.indexOf("Left"));
  assert.ok(body.indexOf("C") > header.indexOf("Center"));
  assert.ok(body.indexOf("R") > header.indexOf("Right"));
  assert.equal(body.length, 12 + 2 + 14 + 2 + 13);
});

test("cell styling and literal pipes survive both tabular and stacked layouts", () => {
  const source =
    "| A | B | C | D | E |\n|---|---|---|---|---|\n| **bold** | *italic* | `x|y` | a\\|b | ~~removed~~ |";
  for (const width of [25, 60]) {
    const rows = buildMarkdownRows(parseMarkdown(source), width);
    const spans = rows.flat();
    assert.ok(spans.some((span) => span.text === "bold" && span.bold));
    assert.ok(spans.some((span) => span.text === "italic" && span.italic));
    assert.ok(spans.some((span) => span.text === "x|y" && span.tone === "info"));
    assert.ok(spans.some((span) => span.text === "removed" && span.strikethrough));
    assert.match(rows.map((row) => row.map((span) => span.text).join("")).join("\n"), /a\|b/);
  }
});

test("headings, lists and code have restrained snapshots and stable hanging indentation", () => {
  assert.deepEqual(
    lines(
      "# Summary\n\n- first item\n  - nested\n3. third\n- [x] complete\n\n```ts\n  const n = 1;\n```",
      40,
    ),
    [
      "Summary",
      "",
      "• first item",
      "  • nested",
      "3. third",
      "☑ complete",
      "",
      "ts",
      "│   const n = 1;",
    ],
  );
  const result = lines("12. " + "word ".repeat(30), 40);
  assert.ok(result.slice(1).every((line) => line.startsWith("    ")));
  assert.ok(
    lines("  ".repeat(1000) + "- keep this text", 40).some((line) =>
      line.includes("keep this text"),
    ),
  );
});

test("code folds preserve exact characters instead of moving words or deleting whitespace", () => {
  const code = "  leading  spaces " + "👩🏽‍💻漢字".repeat(12) + " trailing  ";
  const source = "```ts\nfile.ts\n" + code + "\n\n```";
  for (const width of WIDTHS) {
    const rows = buildMarkdownRows(parseMarkdown(source), width);
    const data = rows.slice(2, -1).map((row) =>
      row
        .filter((span) => span.tone !== "dim")
        .map((span) => span.text)
        .join("")
        .replace(/ +$/, ""),
    );
    // Read source spans, before outer row padding, to retain trailing source spaces.
    const content = rows
      .slice(2, -1)
      .map((row) => row[1]?.text ?? "")
      .join("");
    assert.equal(content, code);
    assert.ok(rows.every((row) => getTextWidth(row.map((span) => span.text).join("")) <= width));
    assert.ok(data.length >= 1);
    if (width < 120) assert.ok(rows.some((row) => row[0]?.text === "↳ "));
    assert.equal(rows[1]?.[1]?.text, "file.ts");
  }
});

test("shell code uses a language label and preserves raw commands and tabs", () => {
  const source = "```bash\n\tprintf 'a  b'  \n\n# Assistant: a meaningful comment\n```";
  assert.deepEqual(lines(source, 60), [
    "bash",
    "│   printf 'a  b'",
    "│",
    "│ # Assistant: a meaningful comment",
  ]);
  const segment = parseMarkdown(source)[0];
  if (segment?.type === "code") assert.equal(segment.lines[0], "\tprintf 'a  b'  ");
});

test("diff highlighting never trims or rewrites the source lines", () => {
  const source = "```diff\n\n-old  \n+new  \n context  \n\n```";
  const rows = buildMarkdownRows(parseMarkdown(source), 40);
  assert.ok(rows.flat().some((span) => span.text === "-old  " && span.tone === "error"));
  assert.ok(rows.flat().some((span) => span.text === "+new  " && span.tone === "success"));
  assert.ok(rows.flat().some((span) => span.text === " context  "));
  assert.equal(rows.length, 6);
});

test("quotes and long links wrap inside the width with access to original targets", () => {
  const source = "> **Quote** [Docs](https://example.org/" + "x".repeat(100) + ")\n>\n> > Nested";
  for (const width of WIDTHS) {
    const rows = buildMarkdownRows(parseMarkdown(source), width);
    assert.ok(rows.every((row) => getTextWidth(row.map((span) => span.text).join("")) <= width));
    const compact = rows
      .flat()
      .map((span) => span.text)
      .join("")
      .replace(/[\s│]/g, "");
    assert.ok(compact.includes("https://example.org/" + "x".repeat(100)));
    assert.ok(rows.flat().some((span) => span.underline));
  }
});

test("inline style boundaries do not create word breaks or lose attributes", () => {
  const spans = [
    createSpan("some "),
    createSpan("pre"),
    createSpan("bold", "text", { bold: true, italic: true, underline: true, strikethrough: true }),
    createSpan("post"),
  ];
  const wrapped = wrapStyledSpans(spans, 12);
  assert.deepEqual(
    wrapped.map((row) =>
      row
        .map((span) => span.text)
        .join("")
        .trimEnd(),
    ),
    ["some", "preboldpost"],
  );
  const styled = wrapped[1]?.find((span) => span.text === "bold");
  assert.ok(styled?.bold && styled.italic && styled.underline && styled.strikethrough);
  const copied = fitSpansToWidth([styled!], 2)[0];
  assert.ok(copied?.italic && copied.underline && copied.strikethrough);
  const appended = [createSpan("a", "text", { italic: true })];
  appendSpan(appended, createSpan("b"));
  assert.equal(appended.length, 2);
  assert.notStrictEqual(
    createRow("style", [createSpan("same")], 12),
    createRow("style", [createSpan("same", "text", { italic: true })], 12),
  );
  assert.ok(
    wrapStyledSpans([createSpan("漢字")], 1).length > 0,
    "wide graphemes must not hang a tiny viewport",
  );
});

test("streaming column allocation stays stable while cell text grows and final output converges", () => {
  const start = "|First|Second|\n|---|---|\n|a|";
  let previousHeader = "";
  for (let i = 1; i <= 80; i += 1) {
    const output = lines(start + "z".repeat(i), 40, true);
    if (previousHeader) assert.equal(output[0], previousHeader);
    previousHeader = output[0]!;
    assert.ok(output.join("").replace(/\s/g, "").includes("z".repeat(i)));
  }
  assert.doesNotMatch(text(start + "z".repeat(80), 40), /\|---|\|First/);
  assert.equal(lines(start + "z".repeat(80) + "|\n", 40, true)[0], previousHeader);
  assert.equal(lines(start + "z".repeat(80) + "|\n|next|value|\n", 40, true)[0], previousHeader);
});

test("resize invalidates layout, preserves content and restores prior-width output", () => {
  const source =
    "|First|Second|Third|Fourth|Fifth|\n|---|---|---|---|---|\n|alpha omega|beta theta|gamma delta|fourth value|fifth value|";
  const wide = lines(source, 120);
  const narrow = lines(source, 40);
  assert.notDeepEqual(wide, narrow);
  assert.deepEqual(lines(source, 120), wide);
  resetTimelineMeasureCaches();
  assert.deepEqual(lines(source, 40), narrow);
});

test("rich layout failures preserve sanitized raw text as a plain fallback", () => {
  const broken = { type: "table", raw: "| keep | all |\n| values | intact |\u001b[2J" } as Segment;
  const result = buildMarkdownRows([broken], 40).map((row) =>
    row.map((span) => span.text).join(""),
  );
  assert.deepEqual(result, ["| keep | all |", "| values | intact |"]);
});
