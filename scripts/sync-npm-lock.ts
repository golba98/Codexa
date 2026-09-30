import { readFileSync, writeFileSync } from "node:fs";

// Keep the consumer shrinkwrap aligned with the graph exercised by Bun tests.
// npm's peer resolver otherwise expands the Harness's cyclic plugin peers.
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const bunLock = Bun.JSONC.parse(readFileSync("bun.lock", "utf8"));
const entries = bunLock.packages as Record<string, [string, string, Record<string, unknown>, string]>;
function packageParts(key: string): string[] {
  const parts = key.split("/"); const names: string[] = [];
  for (let index = 0; index < parts.length; index++) {
    names.push(parts[index]!.startsWith("@") ? `${parts[index]}/${parts[++index]}` : parts[index]!);
  }
  return names;
}
function resolveDependency(owner: string, name: string): string | undefined {
  const parents = packageParts(owner);
  while (parents.length) {
    const key = [...parents, name].join("/");
    if (entries[key]) return key;
    parents.pop();
  }
  return entries[name] ? name : undefined;
}
const production = new Set<string>();
const queue = Object.keys(manifest.dependencies);
while (queue.length) {
  const key = queue.pop()!; if (production.has(key)) continue;
  const entry = entries[key]; if (!entry) throw new Error(`Missing locked dependency: ${key}`);
  production.add(key);
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const name of Object.keys(entry[2][field] as object ?? {})) {
      const resolved = resolveDependency(key, name); if (resolved) queue.push(resolved);
    }
  }
}
const packages: Record<string, unknown> = {
  "": { name: manifest.name, version: manifest.version, license: manifest.license, dependencies: manifest.dependencies, devDependencies: manifest.devDependencies, bin: manifest.bin },
};
for (const [key, [spec, , metadata, integrity]] of Object.entries(entries)) {
  const split = spec.lastIndexOf("@"); const name = spec.slice(0, split); const version = spec.slice(split + 1);
  if (!integrity?.startsWith("sha")) throw new Error(`Unsupported lock entry: ${key}`);
  const { optionalPeers, ...rest } = metadata;
  packages[`node_modules/${packageParts(key).join("/node_modules/")}`] = {
    version,
    resolved: `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz`,
    integrity,
    ...rest,
    ...(metadata.os || metadata.cpu) ? { optional: true } : {},
    ...production.has(key) ? {} : { dev: true },
    ...Array.isArray(optionalPeers) ? { peerDependenciesMeta: Object.fromEntries(optionalPeers.map((name: string) => [name, { optional: true }])) } : {},
  };
}
const lock = { name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages };
for (const path of ["package-lock.json", "npm-shrinkwrap.json"]) writeFileSync(path, JSON.stringify(lock, null, 2) + "\n");
console.log(`Synced ${Object.keys(entries).length} packages (${production.size} runtime dependencies)`);
