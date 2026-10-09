import { expect, test } from "bun:test";
import { normalizeRuntimeConfig, resolveRuntimeConfig } from "../../config/runtimeConfig.js";
import { assessSavedRoute } from "../../session/sessionCatalog.js";
import { providerCatalog } from "../models/modelCatalog.js";
import type { ProviderId } from "../providerLauncher/types.js";
import type { BackendProvider } from "../providers/types.js";
import { createRoutedProvider, getProviderRuntime } from "./registry.js";
import type { ProviderModelDiscoveryResult, ProviderRoute } from "./types.js";

const runtime = resolveRuntimeConfig(normalizeRuntimeConfig({}));
for (const id of ["openai", "anthropic", "google", "mistral", "local"] as ProviderId[])
  test(`${id} refuses a withdrawn persisted model without substituting another`, async () => {
    const native = getProviderRuntime(id);
    const route: ProviderRoute = {
      providerId: id,
      modelId: "withdrawn",
      backendKind: native.backendKind,
    };
    const snapshot: ProviderModelDiscoveryResult = {
      providerId: id,
      backendKind: native.backendKind,
      status: "ready",
      models: [],
      freshness: "verified",
    };
    try {
      await providerCatalog.refresh(
        { ...native, discoverModels: () => snapshot, refreshModels: async () => snapshot },
        { cwd: "/tmp/selection-fixture", forceRefresh: true },
      );
      let called = false;
      let error = "";
      const backend = {
        id: "codex-subprocess",
        label: "Fixture",
        description: "Fixture",
        authState: "delegated",
        authLabel: "Fixture",
        statusMessage: "Fixture",
        supportsModels: () => true,
        run: () => {
          called = true;
          return () => {};
        },
      } as BackendProvider;
      const routed = createRoutedProvider(route, backend, {});
      routed.run!(
        "hello",
        { workspaceRoot: "/tmp/selection-fixture", runtime },
        {
          onResponse: () => {},
          onError: (message) => {
            error = message;
          },
        },
      );
      expect(called).toBe(false);
      expect(error).toContain("Select a model explicitly");
      expect(route.modelId).toBe("withdrawn");
      const assessment = assessSavedRoute(
        {
          providerId: id,
          modelId: "withdrawn",
          backendKind: native.backendKind,
          ...(id === "local" ? { localBackend: "lm-studio" } : {}),
        } as Parameters<typeof assessSavedRoute>[0],
        snapshot,
      );
      expect(assessment.status).toBe("unavailable");
      expect(assessment.route?.modelId).toBe("withdrawn");
    } finally {
      providerCatalog.dispose();
    }
  });
test("saved Mistral aliases resolve only through advertised metadata", () => {
  const discovery: ProviderModelDiscoveryResult = {
    providerId: "mistral",
    backendKind: "mistral-vibe-cli-auth",
    status: "ready",
    freshness: "verified",
    models: [
      {
        id: "native",
        modelId: "native",
        label: "Clean label",
        description: null,
        defaultReasoningLevel: null,
        supportedReasoningLevels: null,
        raw: { vibeAliases: ["stored-alias"] },
      },
    ],
  };
  const assessment = assessSavedRoute(
    { providerId: "mistral", modelId: "stored-alias" } as Parameters<typeof assessSavedRoute>[0],
    discovery,
  );
  expect(assessment.status).toBe("ready");
  expect(assessment.route?.modelId).toBe("stored-alias");
  expect(
    assessSavedRoute(
      { providerId: "mistral", modelId: "Clean label" } as Parameters<typeof assessSavedRoute>[0],
      discovery,
    ).status,
  ).toBe("unavailable");
});

test("native IDs take precedence over colliding advertised aliases", async () => {
  const { resolveCatalogModel } = await import("../models/modelSelection.js");
  const models = [
    {
      id: "other",
      modelId: "other",
      label: "Other",
      description: null,
      defaultReasoningLevel: null,
      supportedReasoningLevels: null,
      raw: { aliases: ["native"] },
    },
    {
      id: "native",
      modelId: "native",
      label: "Native",
      description: null,
      defaultReasoningLevel: null,
      supportedReasoningLevels: null,
    },
  ];
  expect(resolveCatalogModel(models, "native")?.modelId).toBe("native");
});
test("ambiguous historical Vibe alias requires explicit reselection instead of changing targets", async () => {
  const native = getProviderRuntime("mistral");
  const models = [
    {
      id: "old-target",
      modelId: "old-target",
      label: "Original Vibe target",
      description: null,
      defaultReasoningLevel: null,
      supportedReasoningLevels: null,
      raw: { vibeAliases: ["colliding-id"] },
    },
    {
      id: "colliding-id",
      modelId: "colliding-id",
      label: "New API target",
      description: null,
      defaultReasoningLevel: null,
      supportedReasoningLevels: null,
    },
  ];
  const snapshot: ProviderModelDiscoveryResult = {
    providerId: "mistral",
    backendKind: native.backendKind,
    status: "ready",
    freshness: "verified",
    models,
  };
  try {
    await providerCatalog.refresh(
      { ...native, discoverModels: () => snapshot, refreshModels: async () => snapshot },
      { cwd: "/tmp/selection-fixture", forceRefresh: true },
    );
    let error = "";
    const backend = {
      id: "codex-subprocess",
      label: "Fixture",
      description: "Fixture",
      authState: "delegated",
      authLabel: "Fixture",
      statusMessage: "Fixture",
      supportsModels: () => true,
    } as BackendProvider;
    const route: ProviderRoute = {
      providerId: "mistral",
      modelId: "colliding-id",
      backendKind: native.backendKind,
    };
    createRoutedProvider(route, backend, {
      providers: { mistral: { currentModel: "colliding-id" } },
    }).run!(
      "hello",
      { workspaceRoot: "/tmp/selection-fixture", runtime },
      {
        onResponse: () => {},
        onError: (message) => {
          error = message;
        },
      },
    );
    expect(error).toContain("ambiguous");
    expect(route.modelId).toBe("colliding-id");
  } finally {
    providerCatalog.dispose();
  }
});
