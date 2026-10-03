import { resolveRuntimeConfig, type RuntimeConfig, DEFAULT_RUNTIME_CONFIG, type ResolvedRuntimeConfig } from "../config/runtimeConfig.js";

export function makeResolvedRuntime(overrides: Partial<RuntimeConfig> = {}): ResolvedRuntimeConfig {
  return resolveRuntimeConfig({
    ...DEFAULT_RUNTIME_CONFIG,
    ...overrides,
    policy: {
      ...DEFAULT_RUNTIME_CONFIG.policy,
      ...overrides.policy,
    },
  });
}

export const TEST_RUNTIME = makeResolvedRuntime();
