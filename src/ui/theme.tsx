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
  BG: "#0c0b14",
  PANEL: "#171523",
  PANEL_ALT: "#1f1b30",
  PANEL_SOFT: "#12101c",
  BORDER: "#45356c",
  BORDER_ACTIVE: "#6c4eff",
  BORDER_SUBTLE: "#2e2748",
  TEXT: "#f1ebff",
  MUTED: "#b9afd6",
  DIM: "#8f83b5",
  ACCENT: "#9b6dff",
  PROMPT: "#ff7e9f",
  SUCCESS: "#59f092",
  WARNING: "#ffd36d",
  ERROR: "#ff8aa1",
  INFO: "#c68cff",
  STAR: "#df77ff",
};

export const MONO_THEME: Theme = {
  BG: "#000000",
  PANEL: "#050505",
  PANEL_ALT: "#101010",
  PANEL_SOFT: "#050505",
  BORDER: "#7a7a7a",
  BORDER_ACTIVE: "#ffffff",
  BORDER_SUBTLE: "#5a5a5a",
  TEXT: "#ffffff",
  MUTED: "#c5c5c5",
  DIM: "#8a8a8a",
  ACCENT: "#ffffff",
  PROMPT: "#ffffff",
  SUCCESS: "#ffffff",
  WARNING: "#f5f5f5",
  ERROR: "#ffffff",
  INFO: "#d0d0d0",
  STAR: "#ffffff",
};

export const DARK_THEME: Theme = {
  BG: "#0d1117",
  PANEL: "#161b22",
  PANEL_ALT: "#21262d",
  PANEL_SOFT: "#090c10",
  BORDER: "#30363d",
  BORDER_ACTIVE: "#58a6ff",
  BORDER_SUBTLE: "#21262d",
  TEXT: "#c9d1d9",
  MUTED: "#8b949e",
  DIM: "#484f58",
  ACCENT: "#58a6ff",
  PROMPT: "#79c0ff",
  SUCCESS: "#3fb950",
  WARNING: "#d29922",
  ERROR: "#f85149",
  INFO: "#a5d6ff",
  STAR: "#d29922",
};

export const BLACK_THEME: Theme = {
  BG: "#000000",
  PANEL: "#0a0a0a",
  PANEL_ALT: "#121212",
  PANEL_SOFT: "#050505",
  BORDER: "#1a1a1a",
  BORDER_ACTIVE: "#a855f7",
  BORDER_SUBTLE: "#0f0f0f",
  TEXT: "#ffffff",
  MUTED: "#737373",
  DIM: "#404040",
  ACCENT: "#a855f7",
  PROMPT: "#d8b4fe",
  SUCCESS: "#22c55e",
  WARNING: "#f59e0b",
  ERROR: "#ef4444",
  INFO: "#c084fc",
  STAR: "#d8b4fe",
};

export const EMERALD_THEME: Theme = {
  BG: "#060d0b",
  PANEL: "#0d1a17",
  PANEL_ALT: "#142621",
  PANEL_SOFT: "#091210",
  BORDER: "#1b3d35",
  BORDER_ACTIVE: "#10b981",
  BORDER_SUBTLE: "#0f211d",
  TEXT: "#ecfdf5",
  MUTED: "#6ee7b7",
  DIM: "#1a6b4a",
  ACCENT: "#10b981",
  PROMPT: "#a7f3d0",
  SUCCESS: "#34d399",
  WARNING: "#fbbf24",
  ERROR: "#f87171",
  INFO: "#60a5fa",
  STAR: "#fcd34d",
};

export const SOLAR_THEME: Theme = {
  BG: "#0f0c0b",
  PANEL: "#1a1412",
  PANEL_ALT: "#261c1a",
  PANEL_SOFT: "#120e0d",
  BORDER: "#3d2a1b",
  BORDER_ACTIVE: "#f59e0b",
  BORDER_SUBTLE: "#21160f",
  TEXT: "#fffbeb",
  MUTED: "#fcd34d",
  DIM: "#fbbf24",
  ACCENT: "#f59e0b",
  PROMPT: "#fef3c7",
  SUCCESS: "#10b981",
  WARNING: "#fbbf24",
  ERROR: "#ef4444",
  INFO: "#3b82f6",
  STAR: "#fbbf24",
};

export const CYBER_THEME: Theme = {
  BG: "#030014",
  PANEL: "#080026",
  PANEL_ALT: "#0d0033",
  PANEL_SOFT: "#05001a",
  BORDER: "#1f005c",
  BORDER_ACTIVE: "#ff00ff",
  BORDER_SUBTLE: "#140040",
  TEXT: "#ffffff",
  MUTED: "#00ffff",
  DIM: "#00ccff",
  ACCENT: "#ff00ff",
  PROMPT: "#ff00ff",
  SUCCESS: "#00ff00",
  WARNING: "#ffff00",
  ERROR: "#ff0000",
  INFO: "#00ffff",
  STAR: "#ff00ff",
};

export const OCEAN_THEME: Theme = {
  BG: "#0b1217",
  PANEL: "#121d26",
  PANEL_ALT: "#1a2a36",
  PANEL_SOFT: "#0d171e",
  BORDER: "#1b3447",
  BORDER_ACTIVE: "#0ea5e9",
  BORDER_SUBTLE: "#142533",
  TEXT: "#f0f9ff",
  MUTED: "#7dd3fc",
  DIM: "#38bdf8",
  ACCENT: "#0ea5e9",
  PROMPT: "#e0f2fe",
  SUCCESS: "#10b981",
  WARNING: "#f59e0b",
  ERROR: "#ef4444",
  INFO: "#0ea5e9",
  STAR: "#f59e0b",
};

export const NORDIC_THEME: Theme = {
  BG: "#1a1e26",
  PANEL: "#242933",
  PANEL_ALT: "#2e3440",
  PANEL_SOFT: "#21252e",
  BORDER: "#3b4252",
  BORDER_ACTIVE: "#88c0d0",
  BORDER_SUBTLE: "#2e3440",
  TEXT: "#eceff4",
  MUTED: "#d8dee9",
  DIM: "#a3be8c",
  ACCENT: "#88c0d0",
  PROMPT: "#81a1c1",
  SUCCESS: "#a3be8c",
  WARNING: "#ebcb8b",
  ERROR: "#bf616a",
  INFO: "#81a1c1",
  STAR: "#ebcb8b",
};

export const TERMINAL_GREEN: Theme = {
  BG: "#000000",
  PANEL: "#000000",
  PANEL_ALT: "#050505",
  PANEL_SOFT: "#000000",
  BORDER: "#003300",
  BORDER_ACTIVE: "#00ff00",
  BORDER_SUBTLE: "#001100",
  TEXT: "#00ff00",
  MUTED: "#00aa00",
  DIM: "#005500",
  ACCENT: "#00ff00",
  PROMPT: "#00ff00",
  SUCCESS: "#00ff00",
  WARNING: "#88ff00",
  ERROR: "#ff4444",
  INFO: "#00ccff",
  STAR: "#00ff00",
};

export const TERMINAL_AMBER: Theme = {
  BG: "#000000",
  PANEL: "#000000",
  PANEL_ALT: "#050505",
  PANEL_SOFT: "#000000",
  BORDER: "#332200",
  BORDER_ACTIVE: "#ffaa00",
  BORDER_SUBTLE: "#110a00",
  TEXT: "#ffaa00",
  MUTED: "#aa7700",
  DIM: "#553300",
  ACCENT: "#ffaa00",
  PROMPT: "#ffaa00",
  SUCCESS: "#ffaa00",
  WARNING: "#ffdd44",
  ERROR: "#ff6644",
  INFO: "#aaddff",
  STAR: "#ffaa00",
};

export const VAPORWAVE_THEME: Theme = {
  BG: "#1a0b2e",
  PANEL: "#2b1451",
  PANEL_ALT: "#3d1b74",
  PANEL_SOFT: "#1f0d37",
  BORDER: "#ff71ce",
  BORDER_ACTIVE: "#01cdfe",
  BORDER_SUBTLE: "#b967ff",
  TEXT: "#ffffff",
  MUTED: "#01cdfe",
  DIM: "#05ffa1",
  ACCENT: "#ff71ce",
  PROMPT: "#fffb96",
  SUCCESS: "#05ffa1",
  WARNING: "#fffb96",
  ERROR: "#ff71ce",
  INFO: "#01cdfe",
  STAR: "#b967ff",
};

export const DRACULA_THEME: Theme = {
  BG: "#282a36",
  PANEL: "#44475a",
  PANEL_ALT: "#6272a4",
  PANEL_SOFT: "#21222c",
  BORDER: "#6272a4",
  BORDER_ACTIVE: "#bd93f9",
  BORDER_SUBTLE: "#44475a",
  TEXT: "#f8f8f2",
  MUTED: "#8895b8",
  DIM: "#50fa7b",
  ACCENT: "#bd93f9",
  PROMPT: "#ff79c6",
  SUCCESS: "#50fa7b",
  WARNING: "#f1fa8c",
  ERROR: "#ff5555",
  INFO: "#8be9fd",
  STAR: "#f1fa8c",
};

export const GRUVBOX_THEME: Theme = {
  BG: "#1d2021",
  PANEL: "#282828",
  PANEL_ALT: "#3c3836",
  PANEL_SOFT: "#1b1b1b",
  BORDER: "#504945",
  BORDER_ACTIVE: "#fabd2f",
  BORDER_SUBTLE: "#3c3836",
  TEXT: "#fbf1c7",
  MUTED: "#928374",
  DIM: "#b8bb26",
  ACCENT: "#fabd2f",
  PROMPT: "#d79921",
  SUCCESS: "#b8bb26",
  WARNING: "#fabd2f",
  ERROR: "#fb4934",
  INFO: "#83a598",
  STAR: "#fe8019",
};

export const SYNTHWAVE_THEME: Theme = {
  BG: "#262335",
  PANEL: "#241b2f",
  PANEL_ALT: "#20152a",
  PANEL_SOFT: "#2a2139",
  BORDER: "#44355a",
  BORDER_ACTIVE: "#ff7edb",
  BORDER_SUBTLE: "#34294f",
  TEXT: "#ffffff",
  MUTED: "#ff7edb",
  DIM: "#72f1b8",
  ACCENT: "#ff7edb",
  PROMPT: "#f97e72",
  SUCCESS: "#72f1b8",
  WARNING: "#fe8a4f",
  ERROR: "#f92aad",
  INFO: "#03edf9",
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
