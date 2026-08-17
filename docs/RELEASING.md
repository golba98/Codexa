# Codexa Release Guide

This guide documents how to publish `@golba98/codexa` to NPM.

## Prepare version 1.0.16

Run these commands from the repository root. NPM versions are immutable, so
never reuse a version that has already been published.

```bash
npm version 1.0.16 --no-git-tag-version
npm pkg get name version
```

Continue only after the printed version is `1.0.16`.

## Validate the release

```bash
npm whoami
npm view @golba98/codexa version
npm view @golba98/codexa dist-tags --json
bun install
bun run typecheck
bun test
git diff --check
npm pack --dry-run
```

Inspect the dry-run output to confirm that only the intended package files are
included.

## Publish to NPM

```bash
npm publish --access public
```

The `prepublishOnly` lifecycle script automatically regenerates build metadata,
runs the TypeScript typecheck, and runs the full Bun test suite.

## Verify the published package

```bash
npm view @golba98/codexa@1.0.16 version
npm install -g @golba98/codexa@1.0.16
codexa --version
```

After NPM's `latest` tag has propagated, also verify the normal update path:

```bash
npm view @golba98/codexa version
npm install -g @golba98/codexa@latest
codexa --version
```

## Commit and tag the release

```bash
git add package.json package-lock.json CHANGELOG.md README.md src/config/buildInfo.ts docs/RELEASING.md
git commit -m "release: prepare Codexa v1.0.16"
git tag v1.0.16
git push origin main --follow-tags
```
