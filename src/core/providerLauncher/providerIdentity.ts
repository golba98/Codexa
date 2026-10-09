/** Saved Google records require backend provenance; a model name is not evidence. */
export function resolveProviderIdentity(
  providerId: unknown,
  backendKind?: unknown,
  explicitSelection = false,
): string | null {
  if (backendKind === "agy") return "google";
  if (providerId === "antigravity") return "google";
  if (providerId === "google") {
    return explicitSelection || backendKind === "antigravity-cli-auth" ? "google" : null;
  }
  return typeof providerId === "string" ? providerId : null;
}

export const LEGACY_GOOGLE_MESSAGE =
  "This saved Google configuration used the removed Gemini CLI. Its data is preserved. Select Google and an Antigravity model explicitly before sending.";
