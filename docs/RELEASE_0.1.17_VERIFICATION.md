# Ubume 0.1.17 local release verification

Prepared on 2026-10-09 against HEAD `36cd1e53a0d166ce59ab4595e608efb753f01bae`.

- Full serial Bun suite: 2,137 passed, 0 failed across 193 files.
- `bun run build`: build metadata generation, TypeScript and Biome passed.
- `bun run audit:ubume-gap`: 17/17 passed.
- Manifest, both npm lockfiles and generated app version report 0.1.17.
- `node bin/ubume.js --version`: 0.1.17.
- `npm pack --dry-run --json`: 248 files, 632,961 packed bytes. CLI entry point, build metadata and consumer shrinkwrap are present; test files and .env files are absent.
- `git diff --check`: passed.

Test log: `/tmp/ubume-0.1.17-tests.log`. Audit log: `/tmp/ubume-0.1.17-audit.log`. Package manifest: `/tmp/ubume-0.1.17-pack.json`.

The dependency graph is unchanged. npm lockfiles were synchronized using the repository script. Existing generated commit metadata was retained and the app version advanced to 0.1.17.

This preparation did not publish to npm, create a Git commit or create a release tag.
