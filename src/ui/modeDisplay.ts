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
        ringColor: theme.WARNING,
        ringFill: theme.BORDER_SUBTLE,
        iconColor: theme.WARNING,
        labelColor: theme.TEXT,
        labelBold: true,
        ringBold: true,
      };
    case "auto-edit":
      return {
        label: formatModeLabel(mode),
        ringGlyph: "◎",
        ringColor: theme.BORDER_ACTIVE,
        ringFill: theme.PANEL_ALT,
        iconColor: theme.PROMPT,
        labelColor: theme.TEXT,
        labelBold: true,
        ringBold: false,
      };
    case "suggest":
    default:
      return {
        label: formatModeLabel(mode),
        ringGlyph: "○",
        ringColor: theme.SUCCESS,
        ringFill: theme.PANEL_SOFT,
        iconColor: theme.SUCCESS,
        labelColor: theme.MUTED,
        labelBold: false,
        ringBold: false,
      };
  }
}
