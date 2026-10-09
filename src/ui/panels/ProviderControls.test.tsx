import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { render } from "ink";
import type { ReactElement } from "react";
import { providerModelsToCodexCapabilities } from "../../core/providerRuntime/models.js";
import { createLayoutSnapshot } from "../layout.js";
import { ModelPickerScreen } from "./ModelPickerScreen.js";
import { ReasoningBudgetPicker } from "./ReasoningBudgetPicker.js";

class Input extends PassThrough {
  isTTY = true;
  setRawMode() {
    return this;
  }
  override resume() {
    return this;
  }
  override pause() {
    return this;
  }
  ref() {
    return this;
  }
  unref() {
    return this;
  }
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 40));
function harness(node: ReactElement, width: number) {
  const input = new Input();
  const output = new PassThrough() as PassThrough & {
    isTTY: boolean;
    columns: number;
    rows: number;
  };
  output.isTTY = true;
  output.columns = width;
  output.rows = 35;
  let text = "";
  output.on("data", (chunk) => {
    text += String(chunk);
  });
  const instance = render(node, {
    stdin: input as unknown as NodeJS.ReadStream,
    stdout: output as unknown as NodeJS.WriteStream,
    stderr: output as unknown as NodeJS.WriteStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { instance, input, text: () => text, cleanup: () => instance.cleanup() };
}
const levels = ["low", "medium", "high"].map((id) => ({
  id,
  label: id[0]!.toUpperCase() + id.slice(1),
  description: null,
}));
const models = [
  {
    id: "flash",
    modelId: "flash",
    label: "Flash",
    description: null,
    defaultReasoningLevel: "medium",
    supportedReasoningLevels: levels,
    source: "discovered" as const,
  },
  {
    id: "opus",
    modelId: "opus",
    label: "Opus",
    description: null,
    defaultReasoningLevel: "high",
    supportedReasoningLevels: levels,
    source: "discovered" as const,
  },
];
for (const width of [60, 80, 100, 120, 160])
  test(`intelligence arrows, refresh and re-render preserve exact selection at ${width}`, async () => {
    let selected = "";
    let effort = "";
    let refreshes = 0;
    const props = {
      layout: createLayoutSnapshot(width, 35),
      models: providerModelsToCodexCapabilities(models, "flash").models,
      currentModel: "flash",
      currentReasoning: "medium",
      onSelect: (id: string, value: string) => {
        selected = id;
        effort = value;
      },
      onCancel: () => {},
      onRefresh: () => {
        refreshes++;
      },
    };
    const h = harness(<ModelPickerScreen {...props} />, width);
    try {
      await pause();
      h.input.write("\x1b[C");
      await pause();
      h.input.write("r");
      await pause();
      h.instance.rerender(<ModelPickerScreen {...props} models={[...props.models].reverse()} />);
      await pause();
      h.input.write("\r");
      await pause();
      expect(refreshes).toBe(1);
      expect(effort).toBe("high");
      expect(selected).toBe("flash");
      expect(h.text()).not.toContain("TypeError");
    } finally {
      h.cleanup();
    }
  });
test("bounded numeric budget supports typing, confirmation, auto and re-render", async () => {
  const values: string[] = [];
  const props = {
    control: {
      kind: "budget" as const,
      min: 128,
      max: 32768,
      default: -1,
      auto: true,
      canDisable: false,
    },
    value: "high",
    onSelect: (value: string) => values.push(value),
    onCancel: () => {},
  };
  const h = harness(<ReasoningBudgetPicker {...props} />, 100);
  try {
    await pause();
    h.input.write("4096");
    await pause();
    h.instance.rerender(<ReasoningBudgetPicker {...props} />);
    await pause();
    h.input.write("\r");
    await pause();
    expect(values).toEqual(["budget:4096"]);
    h.input.write("a");
    await pause();
    h.input.write("\r");
    await pause();
    expect(values[1]).toBe("auto");
  } finally {
    h.cleanup();
  }
});

test("model navigation restores each model's supported reasoning preference", async () => {
  const catalog = providerModelsToCodexCapabilities(
    [
      {
        id: "a",
        modelId: "a",
        label: "A",
        description: null,
        defaultReasoningLevel: "low",
        supportedReasoningLevels: [
          { id: "low", label: "Low", description: null },
          { id: "high", label: "High", description: null },
        ],
        source: "discovered",
      },
      {
        id: "b",
        modelId: "b",
        label: "B",
        description: null,
        defaultReasoningLevel: "low",
        supportedReasoningLevels: [
          { id: "low", label: "Low", description: null },
          { id: "medium", label: "Medium", description: null },
        ],
        source: "discovered",
      },
    ],
    "a",
  ).models.map((m) => ({ ...m, reasoningPreference: m.model === "a" ? "high" : "medium" }));
  const selected: string[] = [];
  const h = harness(
    <ModelPickerScreen
      layout={createLayoutSnapshot(100, 30)}
      models={catalog}
      currentModel="a"
      currentReasoning="high"
      onSelect={(id, effort) => selected.push(`${id}:${effort}`)}
      onCancel={() => {}}
    />,
    100,
  );
  try {
    await pause();
    h.input.write("\x1b[B");
    await pause();
    h.input.write("\r");
    await pause();
    expect(selected).toEqual(["b:medium"]);
    h.input.write("\x1b[A");
    await pause();
    h.input.write("\r");
    await pause();
    expect(selected.at(-1)).toBe("a:high");
  } finally {
    h.cleanup();
  }
});
