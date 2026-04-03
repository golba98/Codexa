import type { Theme } from "./theme.js";

export function getModeColor(mode: string, theme: Theme): string {
  switch (mode) {
    case "full-auto":
      return theme.ERROR;
    case "auto-edit":
      return theme.WARNING;
    case "suggest":
    default:
      return theme.SUCCESS;
  }
}
