import { expect, test } from "bun:test";
import { isLocalEndpoint, isLocalRuntime } from "./deployment.js";

for (const endpoint of [
  "http://localhost:1234/v1",
  "http://127.0.0.1:11434/v1",
  "http://127.12.3.4:8080/v1",
  "http://[::1]:8000/v1",
  "http://server.localhost/v1",
])
  test(`loopback local ${endpoint}`, () => expect(isLocalEndpoint(endpoint)).toBe(true));
for (const endpoint of [
  "https://cloud.example/v1",
  "http://192.168.1.2/v1",
  "http://localhost.example/v1",
  "malformed",
])
  test(`not implicitly local ${endpoint}`, () => expect(isLocalEndpoint(endpoint)).toBe(false));
test("remote OpenAI-compatible endpoint stays remote; LAN can explicitly opt in", () => {
  const route = {
    providerId: "local" as const,
    modelId: "model",
    backendKind: "local-openai-compatible" as const,
  };
  expect(isLocalRuntime(route, { baseUrl: "https://cloud.example/v1" })).toBe(false);
  expect(isLocalRuntime(route, { baseUrl: "http://192.168.1.2/v1", deployment: "local" })).toBe(
    true,
  );
  expect(isLocalRuntime(route, { baseUrl: "http://localhost/v1", deployment: "remote" })).toBe(
    false,
  );
});
for (const providerId of ["anthropic", "openai", "antigravity", "mistral", "google"] as const)
  test(`${providerId} cloud never becomes local from a context value`, () =>
    expect(
      isLocalRuntime(
        { providerId, modelId: "model", backendKind: "unavailable" },
        { deployment: "local" },
      ),
    ).toBe(false));
