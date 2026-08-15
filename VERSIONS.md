# Codexa Versions

This file explains what users get in each release. For exact implementation
details and test notes, see the [changelog](CHANGELOG.md).

## v1.0.10 — 2026-08-15

This is the current patch release.

Large pastes now stay readable as compact content markers while the full text
still reaches the model. Outside-file imports have clear, keyboard-navigable
one-time consent.

Codex, Claude, Mistral, Antigravity, and Local now share the full Plan review
workflow. Shift+Tab rotates Plan, Read-only, Auto, and Full Access directly in
the composer footer without opening a mode panel or adding notices to chat.
Planning is read-only, and local writes, patches, and shell commands obey the
configured approval policy with an interactive permission prompt.

The update prompt is easier to navigate: use Left and Right to move between
the horizontal Update now and Later actions, then press Enter to confirm.

## v1.0.9 — 2026-08-14

This was the previous patch release.

### Easier terminal panels

Provider, model, theme, settings, and authentication panels now adapt to the
available terminal space. Short terminals show more of the available options,
while longer lists scroll continuously and keep the selected item visible.

### More reliable themes and startup

Theme previews update immediately. Compact terminals keep their choices
readable, and the local development launcher no longer prints an unnecessary
startup block after launch or `/clear`.

### Safer provider behavior

Codexa Native is clearly limited to the local `codexa-dev` channel. Published
Codexa installations continue to use supported external provider routes.

### Security and dependency maintenance

Process argument handling, Windows command validation, workspace checks, and
Cargo diagnostic matching were hardened. The release also updates the
validated Ink, React, TypeScript, and Node type-definition dependencies.

## v1.0.8 — 2026-07-14

This was a packaging-only release. It corrected the published `codexa` binary
metadata without changing the runtime.

## v1.0.7 — 2026-07-14

Provider settings, attachments, and diagnostic logs moved out of project
directories and into user data. Existing `.codexa` files remain available as a
legacy fallback and are not removed automatically.

## v1.0.6 — 2026-07-14

Codexa began checking for newer releases on each interactive startup. Update
messages wait until Codexa is idle, and the suggested command matches the
package manager that installed Codexa.

## v1.0.4 and earlier

Earlier releases introduced the update checker, package-ready startup UI,
provider routing, responsive terminal branding, and the initial Codexa command
line experience. See [CHANGELOG.md](CHANGELOG.md) for the complete history.

## Release policy

- Published npm versions are immutable.
- The `latest` npm tag points to the current public release.
- Local development builds use the separate `codexa-dev` channel.
