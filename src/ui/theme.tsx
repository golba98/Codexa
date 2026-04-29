import React, { createContext, useContext, ReactNode } from "react";
import * as renderDebug from "../core/perf/renderDebug.js";

export interface Theme {
  BG: string;
  PANEL: string;
  PANEL_ALT: string;
  PANEL_SOFT: string;
  BORDER: string;
  BORDER_ACTIVE: string;
  BORDER_SUBTLE: string;
  TEXT: string;
  MUTED: string;
  DIM: string;
  ACCENT: string;
  PROMPT: string;
  SUCCESS: string;
  WARNING: string;
  ERROR: string;
  INFO: string;
  STAR: string;
  LOGO: string[];
}

export const PURPLE_THEME: Theme = {
  BG: "#1A1B26",
  PANEL: "#24283B",
  PANEL_ALT: "#292E42",
  PANEL_SOFT: "#1F2335",
  BORDER: "#414868",
  BORDER_ACTIVE: "#7AA2F7",
  BORDER_SUBTLE: "#292E42",
  TEXT: "#C0CAF5",
  MUTED: "#9AA5CE",
  DIM: "#565F89",
  ACCENT: "#BB9AF7",
  PROMPT: "#7DCFFF",
  SUCCESS: "#9ECE6A",
  WARNING: "#E0AF68",
  ERROR: "#F7768E",
  INFO: "#7AA2F7",
  STAR: "#E0AF68",
  LOGO: ["#BB9AF7", "#7AA2F7", "#7DCFFF", "#9ECE6A"],
};

export const MONO_THEME: Theme = {
  BG: "#0A0A0A",
  PANEL: "#141414",
  PANEL_ALT: "#262626",
  PANEL_SOFT: "#0F0F0F",
  BORDER: "#333333",
  BORDER_ACTIVE: "#E5E5E5",
  BORDER_SUBTLE: "#1A1A1A",
  TEXT: "#F5F5F5",
  MUTED: "#A3A3A3",
  DIM: "#525252",
  ACCENT: "#FFFFFF",
  PROMPT: "#D4D4D4",
  SUCCESS: "#B5B5B5",
  WARNING: "#A3A3A3",
  ERROR: "#E5E5E5",
  INFO: "#8A8A8A",
  STAR: "#FFFFFF",
  LOGO: ["#FFFFFF", "#D4D4D4", "#A3A3A3"],
};

export const DARK_THEME: Theme = {
  BG: "#0D1117",
  PANEL: "#161B22",
  PANEL_ALT: "#21262D",
  PANEL_SOFT: "#0E1218",
  BORDER: "#30363D",
  BORDER_ACTIVE: "#58A6FF",
  BORDER_SUBTLE: "#21262D",
  TEXT: "#C9D1D9",
  MUTED: "#8B949E",
  DIM: "#484F58",
  ACCENT: "#58A6FF",
  PROMPT: "#79C0FF",
  SUCCESS: "#3FB950",
  WARNING: "#D29922",
  ERROR: "#F85149",
  INFO: "#58A6FF",
  STAR: "#E3B341",
  LOGO: ["#58A6FF", "#79C0FF", "#C9D1D9"],
};

export const BLACK_THEME: Theme = {
  BG: "#000000",
  PANEL: "#09090B",
  PANEL_ALT: "#18181B",
  PANEL_SOFT: "#050505",
  BORDER: "#27272A",
  BORDER_ACTIVE: "#F4F4F5",
  BORDER_SUBTLE: "#18181B",
  TEXT: "#FAFAFA",
  MUTED: "#A1A1AA",
  DIM: "#52525B",
  ACCENT: "#E4E4E7",
  PROMPT: "#D4D4D8",
  SUCCESS: "#10B981",
  WARNING: "#F59E0B",
  ERROR: "#EF4444",
  INFO: "#3B82F6",
  STAR: "#FCD34D",
  LOGO: ["#FAFAFA", "#E4E4E7", "#A1A1AA"],
};

export const EMERALD_THEME: Theme = {
  BG: "#021C14",
  PANEL: "#032E22",
  PANEL_ALT: "#044433",
  PANEL_SOFT: "#02251A",
  BORDER: "#065F46",
  BORDER_ACTIVE: "#34D399",
  BORDER_SUBTLE: "#044E39",
  TEXT: "#ECFDF5",
  MUTED: "#6EE7B7",
  DIM: "#059669",
  ACCENT: "#10B981",
  PROMPT: "#34D399",
  SUCCESS: "#A7F3D0",
  WARNING: "#FBBF24",
  ERROR: "#EF4444",
  INFO: "#60A5FA",
  STAR: "#FBBF24",
  LOGO: ["#34D399", "#10B981", "#059669"],
};

export const SOLAR_THEME: Theme = {
  BG: "#1C1917",
  PANEL: "#292524",
  PANEL_ALT: "#44403C",
  PANEL_SOFT: "#221E1C",
  BORDER: "#57534E",
  BORDER_ACTIVE: "#D97706",
  BORDER_SUBTLE: "#44403C",
  TEXT: "#FEF3C7",
  MUTED: "#D6D3D1",
  DIM: "#78716C",
  ACCENT: "#F59E0B",
  PROMPT: "#FBCFE8",
  SUCCESS: "#84CC16",
  WARNING: "#F59E0B",
  ERROR: "#DC2626",
  INFO: "#38BDF8",
  STAR: "#F59E0B",
  LOGO: ["#F59E0B", "#FBCFE8", "#84CC16"],
};

export const CYBER_THEME: Theme = {
  BG: "#020205",
  PANEL: "#0B0C10",
  PANEL_ALT: "#14151C",
  PANEL_SOFT: "#08080A",
  BORDER: "#1E202B",
  BORDER_ACTIVE: "#00FFCC",
  BORDER_SUBTLE: "#111217",
  TEXT: "#E2E8F0",
  MUTED: "#94A3B8",
  DIM: "#475569",
  ACCENT: "#FF007F",
  PROMPT: "#00FFFF",
  SUCCESS: "#00FF99",
  WARNING: "#FFCC00",
  ERROR: "#FF0033",
  INFO: "#00FFFF",
  STAR: "#FF007F",
  LOGO: ["#FF007F", "#00FFFF", "#00FF99", "#FFCC00"],
};

export const OCEAN_THEME: Theme = {
  BG: "#081021",
  PANEL: "#0B1730",
  PANEL_ALT: "#13254A",
  PANEL_SOFT: "#0A1329",
  BORDER: "#1E3A70",
  BORDER_ACTIVE: "#00E5FF",
  BORDER_SUBTLE: "#12244A",
  TEXT: "#E0F2FE",
  MUTED: "#7DD3FC",
  DIM: "#0369A1",
  ACCENT: "#0EA5E9",
  PROMPT: "#38BDF8",
  SUCCESS: "#10B981",
  WARNING: "#F59E0B",
  ERROR: "#F43F5E",
  INFO: "#0EA5E9",
  STAR: "#0EA5E9",
  LOGO: ["#0EA5E9", "#38BDF8", "#7DD3FC"],
};

export const NORDIC_THEME: Theme = {
  BG: "#242933",
  PANEL: "#2E3440",
  PANEL_ALT: "#3B4252",
  PANEL_SOFT: "#292F3B",
  BORDER: "#434C5E",
  BORDER_ACTIVE: "#88C0D0",
  BORDER_SUBTLE: "#3B4252",
  TEXT: "#ECEFF4",
  MUTED: "#D8DEE9",
  DIM: "#4C566A",
  ACCENT: "#8FBCBB",
  PROMPT: "#88C0D0",
  SUCCESS: "#A3BE8C",
  WARNING: "#EBCB8B",
  ERROR: "#BF616A",
  INFO: "#5E81AC",
  STAR: "#EBCB8B",
  LOGO: ["#88C0D0", "#81A1C1", "#5E81AC", "#A3BE8C"],
};

export const TERMINAL_GREEN: Theme = {
  BG: "#050A05",
  PANEL: "#0A140A",
  PANEL_ALT: "#132A13",
  PANEL_SOFT: "#070F07",
  BORDER: "#194A19",
  BORDER_ACTIVE: "#4ADE80",
  BORDER_SUBTLE: "#102B10",
  TEXT: "#4ADE80",
  MUTED: "#22C55E",
  DIM: "#14532D",
  ACCENT: "#86EFAC",
  PROMPT: "#4ADE80",
  SUCCESS: "#86EFAC",
  WARNING: "#FBBF24",
  ERROR: "#EF4444",
  INFO: "#3B82F6",
  STAR: "#22C55E",
  LOGO: ["#4ADE80"],
};

export const TERMINAL_AMBER: Theme = {
  BG: "#0A0500",
  PANEL: "#140A00",
  PANEL_ALT: "#291400",
  PANEL_SOFT: "#0F0800",
  BORDER: "#4A2300",
  BORDER_ACTIVE: "#F59E0B",
  BORDER_SUBTLE: "#2E1600",
  TEXT: "#F59E0B",
  MUTED: "#D97706",
  DIM: "#78350F",
  ACCENT: "#FCD34D",
  PROMPT: "#F59E0B",
  SUCCESS: "#10B981",
  WARNING: "#FDE68A",
  ERROR: "#EF4444",
  INFO: "#60A5FA",
  STAR: "#FDE68A",
  LOGO: ["#F59E0B"],
};

export const VAPORWAVE_THEME: Theme = {
  BG: "#1A0B2E",
  PANEL: "#24183B",
  PANEL_ALT: "#382A52",
  PANEL_SOFT: "#1F1033",
  BORDER: "#4E3A70",
  BORDER_ACTIVE: "#FF71CE",
  BORDER_SUBTLE: "#32204A",
  TEXT: "#F5EEFF",
  MUTED: "#A68CC4",
  DIM: "#5C4A7A",
  ACCENT: "#01CDFE",
  PROMPT: "#05FFA1",
  SUCCESS: "#05FFA1",
  WARNING: "#FFFB96",
  ERROR: "#FF71CE",
  INFO: "#01CDFE",
  STAR: "#FFFB96",
  LOGO: ["#01CDFE", "#FF71CE", "#05FFA1", "#FFFB96"],
};

export const DRACULA_THEME: Theme = {
  BG: "#282A36",
  PANEL: "#383A59",
  PANEL_ALT: "#44475A",
  PANEL_SOFT: "#303247",
  BORDER: "#6272A4",
  BORDER_ACTIVE: "#BD93F9",
  BORDER_SUBTLE: "#44475A",
  TEXT: "#F8F8F2",
  MUTED: "#BFBFBF",
  DIM: "#6272A4",
  ACCENT: "#FF79C6",
  PROMPT: "#8BE9FD",
  SUCCESS: "#50FA7B",
  WARNING: "#F1FA8C",
  ERROR: "#FF5555",
  INFO: "#8BE9FD",
  STAR: "#F1FA8C",
  LOGO: ["#BD93F9", "#FF79C6", "#8BE9FD"],
};

export const GRUVBOX_THEME: Theme = {
  BG: "#282828",
  PANEL: "#3C3836",
  PANEL_ALT: "#504945",
  PANEL_SOFT: "#32302F",
  BORDER: "#665C54",
  BORDER_ACTIVE: "#D79921",
  BORDER_SUBTLE: "#504945",
  TEXT: "#EBDBB2",
  MUTED: "#A89984",
  DIM: "#7C6F64",
  ACCENT: "#FABD2F",
  PROMPT: "#83A598",
  SUCCESS: "#B8BB26",
  WARNING: "#FE8019",
  ERROR: "#FB4934",
  INFO: "#83A598",
  STAR: "#D3869B",
  LOGO: ["#FABD2F", "#B8BB26", "#83A598", "#FE8019"],
};

export const SYNTHWAVE_THEME: Theme = {
  BG: "#211A2D",
  PANEL: "#312644",
  PANEL_ALT: "#42345D",
  PANEL_SOFT: "#281F38",
  BORDER: "#58477B",
  BORDER_ACTIVE: "#FF7EDB",
  BORDER_SUBTLE: "#3A2E52",
  TEXT: "#F6F5F8",
  MUTED: "#A79DC2",
  DIM: "#5D4C82",
  ACCENT: "#36F9F6",
  PROMPT: "#FF7EDB",
  SUCCESS: "#72F1B8",
  WARNING: "#F8DF70",
  ERROR: "#FE4A90",
  INFO: "#36F9F6",
  STAR: "#F97E72",
  LOGO: ["#FF7EDB", "#36F9F6", "#72F1B8", "#F97E72"],
};

export const THEMES: Record<string, Theme> = {
  purple: PURPLE_THEME,
  mono: MONO_THEME,
  dark: DARK_THEME,
  black: BLACK_THEME,
  emerald: EMERALD_THEME,
  solar: SOLAR_THEME,
  cyber: CYBER_THEME,
  ocean: OCEAN_THEME,
  nordic: NORDIC_THEME,
  green: TERMINAL_GREEN,
  amber: TERMINAL_AMBER,
  vaporwave: VAPORWAVE_THEME,
  dracula: DRACULA_THEME,
  gruvbox: GRUVBOX_THEME,
  synthwave: SYNTHWAVE_THEME,
};

// Default for backwards compatibility during migration
export const theme = PURPLE_THEME;

const ThemeContext = createContext<Theme>(PURPLE_THEME);

interface ThemeProviderProps {
  theme?: string;
  customTheme?: Partial<Theme>;
  children: ReactNode;
}

export function ThemeProvider({ theme: themeName = "purple", customTheme, children }: ThemeProviderProps) {
  renderDebug.useLifecycleDebug("ThemeProvider", {
    themeName,
    customTheme: Boolean(customTheme),
  });
  renderDebug.useRenderDebug("ThemeProvider", {
    themeName,
    customTheme: Boolean(customTheme),
  });
  const baseTheme = THEMES[themeName] || PURPLE_THEME;
  const activeTheme = themeName === "custom" ? { ...PURPLE_THEME, ...customTheme } : baseTheme;
  return (
    <ThemeContext.Provider value={activeTheme as Theme}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
