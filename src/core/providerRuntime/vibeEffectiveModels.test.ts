import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { runCommand } from "../process/commandRunner.js";
import { parseVibeEffectiveModels } from "./mistralVibe.js";
import { probeVibeEffectiveModels } from "./vibeEffectiveModels.js";

const inventory = {
  active_model: "",
  default_label: "GLM-5.3 (Mistral Hosted)",
  models: [
    {
      name: "mistral-vibe-cli-latest",
      alias: "mistral-medium-3.5",
      provider: "mistral",
      display_name: "Mistral Medium 3.5",
    },
    { name: "devstral", alias: "local", provider: "llamacpp", display_name: "Devstral (local)" },
    {
      name: "glm-5.3",
      alias: "glm-5-3",
      provider: "mistral",
      display_name: "GLM-5.3 (Mistral Hosted)",
      thinking: "medium",
      thinking_levels: ["off", "medium", "high"],
    },
    { name: "devstral-small", alias: "devstral-small", provider: "mistral" },
  ],
};

test("effective Vibe inventory includes all five native picker entries with exact aliases", () => {
  const result = parseVibeEffectiveModels(inventory);
  expect(result.models.map((m) => m.modelId)).toEqual([
    "Vibe default",
    "mistral-medium-3.5",
    "local",
    "glm-5-3",
    "devstral-small",
  ]);
  expect(result.models[0].label).toBe("Default (currently GLM-5.3 (Mistral Hosted))");
  expect(result.models[3].label).toBe("GLM-5.3 (Mistral Hosted)");
  expect(result.models[3].supportedReasoningLevels?.map((l) => l.id)).toEqual([
    "off",
    "medium",
    "high",
  ]);
  expect(result.models[3].executionVerified).toBe(false);
  expect(result.diagnostics?.modelSource).toBe("vibe-effective-config");
  expect(result.models.some((m) => m.modelId === "codestral-2508")).toBe(false);
});

test("invalid effective configuration fails rather than inventing models", () => {
  expect(() => parseVibeEffectiveModels({ models: [{}] })).toThrow();
  expect(() => parseVibeEffectiveModels({})).toThrow();
});

test("effective probe uses the installed interpreter, reads routing cache and skips migrations", async () => {
  const root = mkdtempSync(join(tmpdir(), "ubume-vibe-probe-"));
  const executable = join(root, "vibe");
  writeFileSync(executable, "#!/installed/vibe/python\n");
  try {
    const runner = ((spec: Parameters<typeof runCommand>[0]) => {
      expect(spec.executable).toBe("/installed/vibe/python");
      expect(spec.cwd).toBe(root);
      expect(spec.args?.[1]).toContain("loader.migrate_config_layers = readonly");
      expect(spec.args?.[1]).toContain("load_cached_eval_response");
      expect(spec.args?.[1]).toContain("available_models()");
      expect(spec.args?.[1]).not.toContain("api_key");
      return {
        result: Promise.resolve({
          status: "completed",
          exitCode: 0,
          stdout: JSON.stringify(inventory),
        }),
        stopped: Promise.resolve(),
        cancel: () => {},
      };
    }) as unknown as typeof runCommand;
    expect(
      await probeVibeEffectiveModels({ executable, cwd: root, runCommandImpl: runner }),
    ).toEqual(inventory);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
