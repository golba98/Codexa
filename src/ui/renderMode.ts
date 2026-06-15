import type { Screen } from "../session/types.js";

export type RenderMode = "terminal-scrollback" | "fullscreen-tui";

export function getRenderModeForScreen(screen: Screen): RenderMode {
  return screen === "main" ? "terminal-scrollback" : "fullscreen-tui";
}
