# Mouse Wheel And Text Selection Verification

Codexa's default mouse path is app-owned wheel scrolling with a fixed composer/status footer. Text selection remains supported through each terminal's mouse-mode selection override.

## Enabled Mouse Modes

- Enabled while default wheel mode is active: `DECSET ?1000h` and `DECSET ?1006h`.
- `?1000h` is normal mouse tracking. Codexa uses this so wheel button reports reach stdin.
- `?1006h` requests SGR mouse coordinates, which Codexa parses for wheel up/down.
- Not enabled: `?1002h` button-motion tracking, `?1003h` any-motion tracking, `?1004h` focus events, `?1005h` UTF-8 mouse mode, `?1015h` URXVT mouse mode, alternate screen `?1049h`.
- Cleanup disables common mouse modes defensively: `?1000l`, `?1002l`, `?1003l`, `?1006l`, `?1015l`.

## Supported Selection Methods

| Terminal | Wheel behavior | Normal drag while mouse mode is active | Supported selection method |
| --- | --- | --- | --- |
| Windows Terminal | Scrolls Codexa timeline | Delivered to Codexa | `Shift+drag` selects visible text |
| VS Code integrated terminal on Windows/Linux | Scrolls Codexa timeline | Delivered to Codexa | `Alt+drag` selects visible text |
| VS Code integrated terminal on macOS | Scrolls Codexa timeline | Delivered to Codexa | `Option+drag`, subject to VS Code terminal selection settings |
| xterm/tmux/screen-like terminals | Scrolls Codexa timeline | Delivered to Codexa | `Shift+drag` is the expected selection override |

## Manual Test Checklist

### Windows Terminal

1. Launch Codexa in Windows Terminal.
2. Produce enough output to scroll.
3. Use the mouse wheel.
4. Confirm only the timeline scrolls and composer/status remain fixed.
5. Try normal drag and record whether it selects text or is delivered to Codexa.
6. Use `Shift+drag` to select visible text.
7. Copy and paste the selected text somewhere else.
8. Confirm copied text is correct.
9. Type in the composer after copy and confirm keyboard input still works.
10. Confirm no alternate screen is used and native terminal scrollback is still present.

### VS Code Integrated Terminal

1. Launch Codexa in the VS Code integrated terminal.
2. Produce enough output to scroll.
3. Use the mouse wheel.
4. Confirm only the timeline scrolls and composer/status remain fixed.
5. Try normal drag and record whether it selects text or is delivered to Codexa.
6. Use `Alt+drag` on Windows/Linux, or `Option+drag` on macOS if enabled, to select visible text.
7. Copy and paste the selected text somewhere else.
8. Confirm copied text is correct.
9. Type in the composer after copy and confirm keyboard input still works.
10. Confirm no alternate screen is used and native terminal scrollback is still present.

## Results

Manual verification is required on the target terminal emulators before closing this task.

| Terminal | Wheel fixed footer | Normal drag selection | Modifier selection/copy | Keyboard after copy | Notes |
| --- | --- | --- | --- | --- | --- |
| Windows Terminal | Not run in this session | Not run in this session | Not run in this session | Not run in this session | Requires local manual verification |
| VS Code integrated terminal | Not run in this session | Not run in this session | Not run in this session | Not run in this session | Requires local manual verification |

## References

- Windows Terminal selection documentation: https://learn.microsoft.com/en-us/windows/terminal/selection
- VS Code terminal basics: https://code.visualstudio.com/docs/terminal/basics
- xterm control sequences: https://invisible-island.net/xterm/ctlseqs/ctlseqs.pdf
