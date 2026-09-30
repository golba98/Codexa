import test from "node:test";
import assert from "node:assert/strict";
import { createRunControl } from "./runControl.js";

test("a canceled logical run waits for all owned processes, including retries", async () => {
  let exposed: Promise<void> | undefined;
  const control = createRunControl({ onResponse() {}, onError() {}, onRunControl(value) { exposed = value.stopped; } });
  let closeFirst!: () => void; let closeRetry!: () => void;
  control.track(new Promise<void>((resolve) => { closeFirst = resolve; }));
  control.track(new Promise<void>((resolve) => { closeRetry = resolve; }));
  let settled = false; void exposed!.then(() => { settled = true; });
  control.finish(); closeFirst(); await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false);
  closeRetry(); await exposed; assert.equal(settled, true);
});
test("rejected owned tasks release cancellation without an unhandled rejection", async () => {
  const control = createRunControl({ onResponse() {}, onError() {} });
  control.track(Promise.reject(new Error("spawn failed"))); control.finish(); await control.stopped;
});
