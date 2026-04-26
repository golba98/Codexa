import assert from "node:assert/strict";
import test from "node:test";
import { schedulePromptRunStartAfterVisibleCommit } from "./promptRunSchedule.js";

function waitForTimerTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("schedulePromptRunStartAfterVisibleCommit waits past the reducer microtask before starting work", async () => {
  const order: string[] = [];

  schedulePromptRunStartAfterVisibleCommit(() => {
    order.push("provider-started");
  });
  order.push("visible-run-dispatched");

  await Promise.resolve();
  assert.deepEqual(order, ["visible-run-dispatched"]);

  await waitForTimerTurn();
  assert.deepEqual(order, ["visible-run-dispatched", "provider-started"]);
});

test("schedulePromptRunStartAfterVisibleCommit can be canceled before provider start", async () => {
  let started = false;

  const cancel = schedulePromptRunStartAfterVisibleCommit(() => {
    started = true;
  });
  cancel();

  await Promise.resolve();
  await waitForTimerTurn();

  assert.equal(started, false);
});
