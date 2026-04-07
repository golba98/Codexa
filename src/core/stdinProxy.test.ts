import assert from "node:assert/strict";
import test from "node:test";
import { createRawModeProxy } from "./stdinProxy.js";

test("createRawModeProxy should mock setRawMode to return true", () => {
  const mockStdin = {} as typeof process.stdin;
  const proxy = createRawModeProxy(mockStdin);
  
  assert.equal(typeof proxy.setRawMode, "function");
  assert.equal(proxy.setRawMode(true), true);
});

test("createRawModeProxy should mock isTTY to return true", () => {
  const mockStdin = {} as typeof process.stdin;
  const proxy = createRawModeProxy(mockStdin);
  
  assert.equal(proxy.isTTY, true);
});

test("createRawModeProxy should pass through other properties and methods", () => {
  const mockStdin = {
    read: () => "data",
    isPaused: () => false,
    testProp: "value",
  } as unknown as typeof process.stdin;
  
  const proxy = createRawModeProxy(mockStdin);
  
  assert.equal(proxy.read(), "data");
  assert.equal(proxy.isPaused(), false);
  assert.equal((proxy as any).testProp, "value");
});
