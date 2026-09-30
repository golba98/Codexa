# Release checks

Run `bun install` after dependency changes, then `npm run prepublishOnly`. The hook synchronizes package-lock.json and npm-shrinkwrap.json from the tested Bun lock before checking types and running all tests. Keep required Harness peer providers explicit in package.json; npm installs use legacy peer mode because automatic resolution repeatedly expands the plugin peer graph.

Pack with `npm pack --ignore-scripts --pack-destination /tmp`. Install that tarball in an isolated prefix using `npm install --global --prefix <temporary-directory> <tarball> --legacy-peer-deps`. Verify the installed version, `doctor --json`, and headless execution with a fixture provider. Run `bun scripts/smoke-packaged-harness.ts <temporary-directory>/lib/node_modules/ubume`; a failed inference must block publication even when checkout tests pass. The smoke script uses a local mock endpoint and makes no paid model calls.

Run the capability audit and terminal smoke script, and include a terminal recording for visible changes. Check the packed files and integrity, update CHANGELOG.md and VERSIONS.md, and push every release commit before merging the PR. Publish only the verified tarball. Confirm both full and abbreviated npm registry metadata list the version with matching integrity before reporting it available.
