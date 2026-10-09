import { expect, test } from "bun:test";
import type { ReasoningControl } from "../providerRuntime/types.js";
import {
  isSupportedReasoning,
  reconcileReasoning,
  stepReasoningBudget,
} from "./reasoningControl.js";

for (const count of [1, 2, 3, 4, 5])
  test(`exactly ${count} advertised levels survive reconciliation`, () => {
    const levels = ["minimal", "low", "medium", "high", "max"]
      .slice(0, count)
      .map((id) => ({ id, label: id, description: null }));
    const control: ReasoningControl = {
      kind: "levels",
      levels,
      default: levels[0]!.id,
      transport: "parameter",
    };
    expect(reconcileReasoning(control, "invalid")).toBe(levels[0]!.id);
    for (const level of levels) expect(isSupportedReasoning(control, level.id)).toBe(true);
    expect(isSupportedReasoning(control, "unsupported")).toBe(false);
  });
for (const kind of ["unknown", "unsupported", "fixed"] as const)
  test(`${kind} models reject adjustable values`, () => {
    const control: ReasoningControl = kind === "fixed" ? { kind, label: "fixed" } : { kind };
    expect(isSupportedReasoning(control, "high")).toBe(false);
    expect(reconcileReasoning(control, "high")).toBe("");
  });
test("budget validates bounds, auto, disabling and step saturation", () => {
  const control: ReasoningControl & { kind: "budget" } = {
    kind: "budget",
    min: 128,
    max: 32768,
    default: -1,
    auto: true,
    canDisable: false,
  };
  for (const value of ["auto", "budget:128", "budget:32768"])
    expect(isSupportedReasoning(control, value)).toBe(true);
  for (const value of [
    "high",
    "budget:0",
    "budget:127",
    "budget:32769",
    "budget:NaN",
    "budget:128.5",
  ])
    expect(isSupportedReasoning(control, value)).toBe(false);
  expect(stepReasoningBudget(control, "budget:32768", 1)).toBe("budget:32768");
  expect(stepReasoningBudget(control, "budget:128", -1)).toBe("budget:128");
  expect(reconcileReasoning(control, "high")).toBe("auto");
  expect(isSupportedReasoning({ ...control, canDisable: true }, "budget:0")).toBe(true);
});
