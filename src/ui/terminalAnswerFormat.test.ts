import assert from "node:assert/strict";
import test from "node:test";
import { formatTerminalAnswerInline } from "./terminalAnswerFormat.js";

test("terminal answer formatting collapses local markdown links and Windows paths", () => {
  const formatted = formatTerminalAnswerInline([
    "- [`src/App.tsx`](C:/Users/jorda/OneDrive/Desktop/Project/src/App.tsx#L22)",
    "- [README.md](file:///C:/Users/jorda/OneDrive/Desktop/Project/README.md)",
    "- C:\\Users\\jorda\\OneDrive\\Desktop\\Project\\docs\\proof.md#L26",
    "- [OpenAI](https://platform.openai.com/docs)",
  ].join("\n"));

  assert.match(formatted, /src\/App\.tsx:22/);
  assert.match(formatted, /README\.md/);
  assert.match(formatted, /docs\/proof\.md:26/);
  assert.match(formatted, /\[OpenAI\]\(https:\/\/platform\.openai\.com\/docs\)/);
  assert.doesNotMatch(formatted, /C:\/Users|C:\\Users|file:\/\//);
  assert.doesNotMatch(formatted, /\]\(C:/);
});
