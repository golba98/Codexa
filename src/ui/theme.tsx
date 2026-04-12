import React, { createContext, useContext, ReactNode } from "react";

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
}

export const PURPLE_THEME: Theme = {
  BG: "#1a1b26",
  PANEL: "#24283b",
  PANEL_ALT: "#292e42",
  PANEL_SOFT: "#1f2335",
  BORDER: "#414868",
  BORDER_ACTIVE: "#7aa2f7",
  BORDER_SUBTLE: "#292e42",
  TEXT: "#c0caf5",
  MUTED: "#9aa5ce",
  DIM: "#565f89",
  ACCENT: "#bb9af7",
  PROMPT: "#7dcfff",
  SUCCESS: "#9ece6a",
  WARNING: "#e0af68",
  ERROR: "#f7768e",
  INFO: "#7aa2f7",
  STAR: "#ff9e64",
};

export const MONO_THEME: Theme = {
  BG: "#121212",
  PANEL: "#1e1e1e",
  PANEL_ALT: "#2d2d2d",
  PANEL_SOFT: "#161616",
  BORDER: "#3a3a3a",
  BORDER_ACTIVE: "#ffffff",
  BORDER_SUBTLE: "#262626",
  TEXT: "#f4f4f5",
  MUTED: "#a1a1aa",
  DIM: "#52525b",
  ACCENT: "#e4e4e7",
  PROMPT: "#d4d4d8",
  SUCCESS: "#e4e4e7",
  WARNING: "#d4d4d8",
  ERROR: "#ffffff",
  INFO: "#a1a1aa",
  STAR: "#ffffff",
};

export const DARK_THEME: Theme = {
  BG: "#1e2127",
  PANEL: "#282c34",
  PANEL_ALT: "#353b45",
  PANEL_SOFT: "#21252b",
  BORDER: "#3e4451",
  BORDER_ACTIVE: "#61afef",
  BORDER_SUBTLE: "#2c313a",
  TEXT: "#abb2bf",
  MUTED: "#7f848e",
  DIM: "#5c6370",
  ACCENT: "#c678dd",
  PROMPT: "#61afef",
  SUCCESS: "#98c379",
  WARNING: "#e5c07b",
  ERROR: "#e06c75",
  INFO: "#56b6c2",
  STAR: "#d19a66",
};

export const BLACK_THEME: Theme = {
  BG: "#000000",
  PANEL: "#0a0a0c",
  PANEL_ALT: "#141417",
  PANEL_SOFT: "#050506",
  BORDER: "#1f1f24",
  BORDER_ACTIVE: "#8b5cf6",
  BORDER_SUBTLE: "#111114",
  TEXT: "#f8fafc",
  MUTED: "#94a3b8",
  DIM: "#334155",
  ACCENT: "#a78bfa",
  PROMPT: "#c4b5fd",
  SUCCESS: "#10b981",
  WARNING: "#f59e0b",
  ERROR: "#ef4444",
  INFO: "#3b82f6",
  STAR: "#fcd34d",
};

export const EMERALD_THEME: Theme = {
  BG: "#022c22",
  PANEL: "#064e3b",
  PANEL_ALT: "#065f46",
  PANEL_SOFT: "#023c2d",
  BORDER: "#059669",
  BORDER_ACTIVE: "#34d399",
  BORDER_SUBTLE: "#047857",
  TEXT: "#ecfdf5",
  MUTED: "#a7f3d0",
  DIM: "#059669",
  ACCENT: "#6ee7b7",
  PROMPT: "#34d399",
  SUCCESS: "#10b981",
  WARNING: "#fbbf24",
  ERROR: "#ef4444",
  INFO: "#60a5fa",
  STAR: "#fcd34d",
};

export const SOLAR_THEME: Theme = {
  BG: "#282420",
  PANEL: "#3c3836",
  PANEL_ALT: "#504945",
  PANEL_SOFT: "#32302f",
  BORDER: "#665c54",
  BORDER_ACTIVE: "#fabd2f",
  BORDER_SUBTLE: "#504945",
  TEXT: "#ebdbb2",
  MUTED: "#a89984",
  DIM: "#7c6f64",
  ACCENT: "#fe8019",
  PROMPT: "#83a598",
  SUCCESS: "#b8bb26",
  WARNING: "#fabd2f",
  ERROR: "#fb4934",
  INFO: "#83a598",
  STAR: "#d3869b",
};

export const CYBER_THEME: Theme = {
  BG: "#09090b",
  PANEL: "#121215",
  PANEL_ALT: "#1a1b22",
  PANEL_SOFT: "#0d0d10",
  BORDER: "#272a38",
  BORDER_ACTIVE: "#fbf236",
  BORDER_SUBTLE: "#1b1d27",
  TEXT: "#f4f4f5",
  MUTED: "#71717a",
  DIM: "#3f3f46",
  ACCENT: "#fbf236",
  PROMPT: "#ff003c",
  SUCCESS: "#00f0ff",
  WARNING: "#fbf236",
  ERROR: "#ff003c",
  INFO: "#00f0ff",
  STAR: "#ff003c",
};

export const OCEAN_THEME: Theme = {
  BG: "#0f172a",
  PANEL: "#1e293b",
  PANEL_ALT: "#334155",
  PANEL_SOFT: "#152033",
  BORDER: "#475569",
  BORDER_ACTIVE: "#38bdf8",
  BORDER_SUBTLE: "#2a364a",
  TEXT: "#f8fafc",
  MUTED: "#94a3b8",
  DIM: "#475569",
  ACCENT: "#0ea5e9",
  PROMPT: "#7dd3fc",
  SUCCESS: "#10b981",
  WARNING: "#f59e0b",
  ERROR: "#f43f5e",
  INFO: "#3b82f6",
  STAR: "#fbbf24",
};

export const NORDIC_THEME: Theme = {
  BG: "#2e3440",
  PANEL: "#3b4252",
  PANEL_ALT: "#434c5e",
  PANEL_SOFT: "#343b49",
  BORDER: "#4c566a",
  BORDER_ACTIVE: "#88c0d0",
  BORDER_SUBTLE: "#434c5e",
  TEXT: "#e5e9f0",
  MUTED: "#d8dee9",
  DIM: "#4c566a",
  ACCENT: "#81a1c1",
  PROMPT: "#88c0d0",
  SUCCESS: "#a3be8c",
  WARNING: "#ebcb8b",
  ERROR: "#bf616a",
  INFO: "#b48ead",
  STAR: "#ebcb8b",
};

export const TERMINAL_GREEN: Theme = {
  BG: "#050a05",
  PANEL: "#0a140a",
  PANEL_ALT: "#122412",
  PANEL_SOFT: "#080f08",
  BORDER: "#1a381a",
  BORDER_ACTIVE: "#22c55e",
  BORDER_SUBTLE: "#0f200f",
  TEXT: "#4ade80",
  MUTED: "#16a34a",
  DIM: "#14532d",
  ACCENT: "#22c55e",
  PROMPT: "#86efac",
  SUCCESS: "#22c55e",
  WARNING: "#fbbf24",
  ERROR: "#ef4444",
  INFO: "#3b82f6",
  STAR: "#22c55e",
};

export const TERMINAL_AMBER: Theme = {
  BG: "#120a00",
  PANEL: "#1a1005",
  PANEL_ALT: "#2b1c10",
  PANEL_SOFT: "#140c03",
  BORDER: "#402a15",
  BORDER_ACTIVE: "#f59e0b",
  BORDER_SUBTLE: "#28180d",
  TEXT: "#fbbf24",
  MUTED: "#b45309",
  DIM: "#78350f",
  ACCENT: "#f59e0b",
  PROMPT: "#fcd34d",
  SUCCESS: "#10b981",
  WARNING: "#fde68a",
  ERROR: "#ef4444",
  INFO: "#60a5fa",
  STAR: "#f59e0b",
};

export const VAPORWAVE_THEME: Theme = {
  BG: "#1d1933",
  PANEL: "#2b254a",
  PANEL_ALT: "#3f366b",
  PANEL_SOFT: "#231e3d",
  BORDER: "#5e5299",
  BORDER_ACTIVE: "#ff71ce",
  BORDER_SUBTLE: "#3c3366",
  TEXT: "#f8f7ff",
  MUTED: "#01cdfe",
  DIM: "#403770",
  ACCENT: "#05ffa1",
  PROMPT: "#b967ff",
  SUCCESS: "#05ffa1",
  WARNING: "#fffb96",
  ERROR: "#ff71ce",
  INFO: "#01cdfe",
  STAR: "#fffb96",
};

export const DRACULA_THEME: Theme = {
  BG: "#282a36",
  PANEL: "#383a59",
  PANEL_ALT: "#44475a",
  PANEL_SOFT: "#303247",
  BORDER: "#6272a4",
  BORDER_ACTIVE: "#bd93f9",
  BORDER_SUBTLE: "#44475a",
  TEXT: "#f8f8f2",
  MUTED: "#bfbfbf",
  DIM: "#6272a4",
  ACCENT: "#ff79c6",
  PROMPT: "#bd93f9",
  SUCCESS: "#50fa7b",
  WARNING: "#f1fa8c",
  ERROR: "#ff5555",
  INFO: "#8be9fd",
  STAR: "#f1fa8c",
};

export const GRUVBOX_THEME: Theme = {
  BG: "#282828",
  PANEL: "#3c3836",
  PANEL_ALT: "#504945",
  PANEL_SOFT: "#32302f",
  BORDER: "#665c54",
  BORDER_ACTIVE: "#d79921",
  BORDER_SUBTLE: "#504945",
  TEXT: "#ebdbb2",
  MUTED: "#a89984",
  DIM: "#928374",
  ACCENT: "#fabd2f",
  PROMPT: "#83a598",
  SUCCESS: "#b8bb26",
  WARNING: "#fe8019",
  ERROR: "#fb4934",
  INFO: "#83a598",
  STAR: "#d3869b",
};

export const SYNTHWAVE_THEME: Theme = {
  BG: "#241b2f",
  PANEL: "#34294f",
  PANEL_ALT: "#4d3b76",
  PANEL_SOFT: "#2a2139",
  BORDER: "#67509c",
  BORDER_ACTIVE: "#ff7edb",
  BORDER_SUBTLE: "#44355a",
  TEXT: "#ffffff",
  MUTED: "#36f9f6",
  DIM: "#4f3c7e",
  ACCENT: "#f97e72",
  PROMPT: "#ff7edb",
  SUCCESS: "#72f1b8",
  WARNING: "#f8df70",
  ERROR: "#fe4a90",
  INFO: "#36f9f6",
  STAR: "#f97e72",
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
