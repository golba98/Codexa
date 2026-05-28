import { formatModeLabel } from "../config/settings.js";
import type { Theme } from "./theme.js";

export interface ModeDisplaySpec {
  label: string;
  ringGlyph: string;
  ringColor: string;
  ringFill: string;
  iconColor: string;
  labelColor: string;
  labelBold: boolean;
  ringBold: boolean;
}

export function getModeDisplaySpec(mode: string, theme: Theme): ModeDisplaySpec {
  switch (mode) {
    case "full-auto":
      return {
        label: formatModeLabel(mode),
        ringGlyph: "◉",
        ringColor: theme.warning,
        ringFill: theme.border,
        iconColor: theme.warning,
        labelColor: theme.text,
        labelBold: true,
        ringBold: true,
      };
    case "auto-edit":
      return {
        label: formatModeLabel(mode),
        ringGlyph: "◎",
        ringColor: theme.borderFocused,
        ringFill: theme.surfaceMuted,
        iconColor: theme.prompt,
        labelColor: theme.text,
        labelBold: true,
        ringBold: false,
      };
    case "suggest":
    default:
      return {
        label: formatModeLabel(mode),
        ringGlyph: "○",
        ringColor: theme.success,
        ringFill: theme.surfaceMuted,
        iconColor: theme.success,
        labelColor: theme.textMuted,
        labelBold: false,
        ringBold: false,
      };
  }
}
