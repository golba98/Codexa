# Terminal workbench

The composer remains editable during provider and shell runs. Enter during a
provider run queues an instruction with its expanded text and image attachments.
Accepted instructions run once, in order, after the previous provider has stopped
and its file checkpoint has finished. Failure, cancellation, approval requests,
questions, and plan review pause automatic execution. `/queue` lets you edit,
delete, reorder, pause, or continue pending instructions.

| Action | Shortcut or command |
|---|---|
| Line start/end | Ctrl+A / Ctrl+E |
| Character movement | Ctrl+B / Ctrl+F |
| Word movement | Alt+B / Alt+F |
| Delete previous word | Ctrl+W |
| Delete to line start/end | Ctrl+U / Ctrl+K |
| Restore deleted text | Ctrl+Y |
| Search history | Ctrl+R; repeat to find the next match |
| Undo input | Ctrl+_ |
| Newline | Shift+Enter when supported, Alt+Enter, Ctrl+J, or backslash then Enter |
| External editor | Ctrl+G; uses VISUAL, then EDITOR |
| Stop active run | Ctrl+C or Esc; draft and session remain intact |
| Redraw viewport | Ctrl+L; conversation and scrollback remain intact |
| Model picker | Alt+P |
| Provider picker | Ctrl+Alt+P |
| Execution mode | Shift+Tab |
| Send queued instructions immediately | Ctrl+X then Ctrl+S, or `/send-now` |
| Inspect tool activity | Ctrl+O or `/transcript` |
| Review file changes | `/diff` |
| Preview recovery | `/rewind` |
| Resume | `/resume` picker, or `/resume <id>` |
| Clear conversation | `/clear` |
| Exit | Ctrl+Q or `/exit`; idle Ctrl+C twice also exits |

Up/Down move through visual lines before entering prompt history. Leaving history
restores the original draft and cursor. Attachments behave as a single unit during
cursor movement and deletion. Typing `@` opens file suggestions; Up/Down choose a
file and Tab or Enter attaches it. Git ignore rules apply, with a recursive
`.gitignore` fallback outside Git. Symlinks, generated directories, and `.env`
files are excluded. Text attachments are limited to 1 MiB per file and 8 MiB per
prompt. Queued file content is fixed at submission; editing a queued instruction
places that expanded content into the draft and retains its image attachments.

Send-now uses provider steering when a runtime exposes it. Current runtime
adapters use interrupt-and-continue: cancel the current process, await cleanup,
and start one follow-up containing the pending instructions and current draft.
The queue remains paused after this explicit continuation. Late callbacks from a
canceled run cannot overwrite the new turn.

## Inspect and recover

The transcript shows timestamps, models, status, commands, errors, supplied tool
output, and detected file changes. Enter expands a selected entry, `/` searches,
and PgUp/PgDn scroll. Providers that do not supply detailed output are identified
in the viewer. Captured tool output is limited to 256 KiB per tool and 8 MiB per
turn, with a visible truncation marker.

Checkpoints are captured around provider turns. The diff viewer compares
supported text files across the session or a chosen
turn. Left/Right chooses the scope, Up/Down selects a file, and Enter opens its
patch. It includes supported tracked, untracked, created, and deleted files and
preserves the dirty workspace baseline before the first run.

The rewind picker offers conversation-only (`c`), files-only (`f`), or both (`b`).
Enter first displays a preview; a second Enter applies it. Conversation recovery
creates a branch and retains the original session. File recovery preserves exact
bytes, CRLF, and permissions. Later manual edits, missing blobs, symlinks, or
incomplete required checkpoints block restoration. A journal rolls back failed
or interrupted restorations; startup resume checks that journal before allowing
new work. Binary and oversized files are omitted. Each boundary is limited to
64 MiB, and stored checkpoint blobs to 256 MiB per conversation; exceeding these
limits disables file restoration for affected checkpoints. Checkpoints cover
workspace text files, not external processes or external state.

## Persistence and resume

One atomically replaced `snapshot.json` stores dialogue, exact submitted context,
transcript, draft/cursor, history, attachment registries, pending instructions,
plan review state, and file checkpoints. Older `messages.json`/`metadata.json`
sessions remain readable. Invalid auxiliary state falls back to dialogue-only
recovery. Saved active runs become interrupted turns; partial replies remain
visible and available to the next provider request. Resumed queues always start
paused. Missing image files or unresolved attachment chips produce a visible
error before submission.

Resume restores Ubume's state. It does not promise to reattach native Claude or
Codex sessions; their next invocation receives saved Ubume conversation context.
The chosen route is restored when available and otherwise falls back with a
notice. Native Local Harness session metadata retains its existing validation.

## Verification

`bun test src/session/workbenchApp.test.ts` runs actual Ink app instances in fresh
processes using a deterministic provider. It exercises abrupt restart, draft and
partial reply recovery, a paused resumed queue, FIFO dispatch, send-now, provider
cleanup, stale callbacks, and draft preservation during cancellation.

`python3 scripts/smoke-workbench.py` creates a temporary workspace and data root,
uses a deterministic provider, and records the actual app through a PTY. It does
not invoke a paid provider. Play the included [recording](terminal-workbench.cast)
with `asciinema play docs/terminal-workbench.cast`. Live authenticated provider
behavior still depends on the installed provider CLI and terminal keyboard
protocol; the recording is a UI smoke test.
