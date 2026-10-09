import assert from "node:assert/strict";
import test from "node:test";
import { dispatchCommand } from "./commandDispatch.js";

type DispatchContext = Parameters<typeof dispatchCommand>[0];

function recordingContext(commandResult: DispatchContext["commandResult"]) {
  const calls: string[] = [];
  const context = new Proxy({ commandResult } as DispatchContext, {
    get(target, property) {
      if (property in target) return target[property as keyof DispatchContext];
      return (...args: unknown[]) => {
        calls.push(`${String(property)}(${args.map((arg) => JSON.stringify(arg)).join(",")})`);
        return Promise.resolve();
      };
    },
  });
  return { context, calls };
}

test("open_usage_panel opens the panel without appending transcript events", () => {
  const { context, calls } = recordingContext({ action: "open_usage_panel" });
  dispatchCommand(context);
  assert.deepEqual(calls, ["openUsagePanel()"]);
});
