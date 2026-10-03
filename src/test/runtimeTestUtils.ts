import {
  DEFAULT_RUNTIME_CONFIG,
  type ResolvedRuntimeConfig,
  type RuntimeConfig,
  resolveRuntimeConfig,
} from "../config/runtimeConfig.js";

function makeResolvedRuntime(overrides: Partial<RuntimeConfig> = {}): ResolvedRuntimeConfig {
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
