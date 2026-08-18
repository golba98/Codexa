import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildCodexaNativePrompt,
  CODEXA_NATIVE_MODEL_ID,
  codexaNativeRuntime,
  DEFAULT_CODEXA_NATIVE_MODEL_ROOT,
  discoverCodexaNativeModels,
  resolveCodexaNativeConfig,
} from "./codexaNative.js";

test("Codexa Native prompt establishes Codexa identity", () => {
  const prompt = buildCodexaNativePrompt("Who are you?");
  assert.match(prompt, /You are Codexa/);
  assert.match(prompt, /never as Open Assistant/);
  assert.match(prompt, /User request:\nWho are you\?/);
});

test("Codexa Native resolves explicit model paths", () => {
  const config = resolveCodexaNativeConfig({
    CODEXA_NATIVE_MODEL_ROOT: "/models/codexa",
    CODEXA_NATIVE_PYTHON: "/python",
    CODEXA_NATIVE_CHECKPOINT: "/checkpoint.pt",
    CODEXA_NATIVE_TOKENIZER: "/tokenizer.json",
    CODEXA_NATIVE_DEVICE: "cpu",
  });

  assert.equal(config.bridgeScript, "/models/codexa/scripts/native_chat_bridge.py");
  assert.equal(config.python, "/python");
  assert.equal(config.checkpoint, "/checkpoint.pt");
  assert.equal(config.tokenizer, "/tokenizer.json");
  assert.equal(config.device, "cpu");
});

test("Codexa Native defaults to the canonical PyTorch checkout", () => {
  const config = resolveCodexaNativeConfig({});
  assert.equal(config.modelRoot, DEFAULT_CODEXA_NATIVE_MODEL_ROOT);
  assert.equal(config.bridgeScript, join(DEFAULT_CODEXA_NATIVE_MODEL_ROOT, "scripts", "native_chat_bridge.py"));
  assert.equal(config.checkpoint, join(DEFAULT_CODEXA_NATIVE_MODEL_ROOT, "checkpoints", "codexa-900m-sft-v2", "latest.pt"));
  assert.equal(config.tokenizer, join(DEFAULT_CODEXA_NATIVE_MODEL_ROOT, "checkpoints", "tokenizer-base-v1", "tokenizer.json"));
});

test("Codexa Native discovery returns not-configured in production channel", () => {
  const result = discoverCodexaNativeModels(undefined, { CODEXA_CHANNEL: "published" });
  assert.equal(result.status, "not-configured");
  assert.match(result.message ?? "", /only available on codexa-dev/);
});

test("Codexa Native discovery exposes the direct PyTorch model in local-dev channel when files exist", () => {
  const root = mkdtempSync(join(tmpdir(), "codexa-native-"));
  try {
    const scripts = join(root, "scripts");
    const checkpoint = join(root, "latest.pt");
    const tokenizer = join(root, "tokenizer.json");
    const python = join(root, "python");
    mkdirSync(scripts);
    for (const path of [join(scripts, "native_chat_bridge.py"), checkpoint, tokenizer, python]) {
      writeFileSync(path, "fixture");
    }

    const result = discoverCodexaNativeModels(
      {
        modelRoot: root,
        python,
        bridgeScript: join(scripts, "native_chat_bridge.py"),
        checkpoint,
        tokenizer,
        device: "cpu",
      },
      { CODEXA_CHANNEL: "local-dev" },
    );

    assert.equal(result.status, "ready");
    assert.equal(result.backendKind, "codexa-native-pytorch");
    assert.equal(result.models[0]?.modelId, CODEXA_NATIVE_MODEL_ID);
    assert.equal(codexaNativeRuntime.providerId, "codexa-native");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
