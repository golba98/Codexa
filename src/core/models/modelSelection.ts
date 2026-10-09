import type { ProviderModel } from "../providerRuntime/types.js";
import { isRecord } from "../shared/values.js";

/** Aliases are provider-advertised or Vibe configuration mappings, never inferred from labels. */
export function resolveCatalogModel(
  models: readonly ProviderModel[],
  id: string,
): ProviderModel | undefined {
  const exact = models.find((model) => model.modelId === id || model.id === id);
  if (exact) return exact;
  return models.find(
    (model) =>
      model.canonicalId === id ||
      (isRecord(model.raw) &&
        [model.raw.aliases, model.raw.vibeAliases].some(
          (aliases) => Array.isArray(aliases) && aliases.includes(id),
        )),
  );
}
