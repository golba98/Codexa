import React, { createContext, useContext, ReactNode } from "react";
import * as renderDebug from "../core/perf/renderDebug.js";

export interface Theme {
  bg: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  borderFocused: string;
  text: string;
  textMuted: string;
  textDim: string;
  accent: string;
  accentMuted: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  command: string;
  prompt: string;
  model: string;
  provider: string;
  context: string;
  logoPrimary: string;
  logoSecondary: string;
  logoShadow: string;
}

// ─── Theme definitions ────────────────────────────────────────────────────────

export const DARK_THEME = {
  bg: "#0E0E10",
  surface: "#18181B",
  surfaceMuted: "#111113",
  border: "#27272A",
  borderFocused: "#2DD4BF",
  accent: "#10B981",
  accentMuted: "#059669",
  text: "#F4F4F5",
  textMuted: "#A1A1AA",
  textDim: "#52525B",
  success: "#22C55E",
  warning: "#F59E0B",
  error: "#EF4444",
  info: "#06B6D4",
  command: "#34D399",
  prompt: "#10B981",
  model: "#60A5FA",
  provider: "#6EE7B7",
  context: "#67E8F9",
  logoPrimary: "#34D399",
  logoSecondary: "#10B981",
  logoShadow: "#064E3B",
} satisfies Theme;

export const PURPLE_THEME = {
  bg: "#12101C",
  surface: "#1B162E",
  surfaceMuted: "#151224",
  border: "#3B2C66",
  borderFocused: "#BB9AF7",
  accent: "#BB9AF7",
  accentMuted: "#9D78E3",
  text: "#E2D9FA",
  textMuted: "#9AA5CE",
  textDim: "#565F89",
  success: "#9ECE6A",
  warning: "#E0AF68",
  error: "#F7768E",
  info: "#7AA2F7",
  command: "#BB9AF7",
  prompt: "#7DCFFF",
  model: "#89DDFF",
  provider: "#B4F9F8",
  context: "#89DDFF",
  logoPrimary: "#BB9AF7",
  logoSecondary: "#7AA2F7",
  logoShadow: "#3B2C66",
} satisfies Theme;

export const MONO_THEME = {
  bg: "#0F0F0F",
  surface: "#1A1A1A",
  surfaceMuted: "#141414",
  border: "#333333",
  borderFocused: "#FAFAFA",
  accent: "#FAFAFA",
  accentMuted: "#A3A3A3",
  text: "#F5F5F5",
  textMuted: "#A3A3A3",
  textDim: "#525252",
  success: "#D4D4D4",
  warning: "#A3A3A3",
  error: "#E5E5E5",
  info: "#8A8A8A",
  command: "#E5E5E5",
  prompt: "#D4D4D4",
  model: "#E5E5E5",
  provider: "#A3A3A3",
  context: "#A3A3A3",
  logoPrimary: "#FAFAFA",
  logoSecondary: "#D4D4D4",
  logoShadow: "#525252",
} satisfies Theme;

export const BLACK_THEME = {
  bg: "#000000",
  surface: "#0D0D10",
  surfaceMuted: "#060608",
  border: "#242427",
  borderFocused: "#FAFAFA",
  accent: "#F4F4F5",
  accentMuted: "#A1A1AA",
  text: "#FAFAFA",
  textMuted: "#A1A1AA",
  textDim: "#52525B",
  success: "#10B981",
  warning: "#F59E0B",
  error: "#EF4444",
  info: "#3B82F6",
  command: "#FAFAFA",
  prompt: "#D4D4D8",
  model: "#60A5FA",
  provider: "#A7F3D0",
  context: "#67E8F9",
  logoPrimary: "#FAFAFA",
  logoSecondary: "#A1A1AA",
  logoShadow: "#52525B",
} satisfies Theme;

export const NORDIC_THEME = {
  bg: "#1E222A",
  surface: "#2E3440",
  surfaceMuted: "#242933",
  border: "#3B4252",
  borderFocused: "#88C0D0",
  accent: "#8FBCBB",
  accentMuted: "#81A1C1",
  text: "#ECEFF4",
  textMuted: "#D8DEE9",
  textDim: "#4C566A",
  success: "#A3BE8C",
  warning: "#EBCB8B",
  error: "#BF616A",
  info: "#5E81AC",
  command: "#88C0D0",
  prompt: "#88C0D0",
  model: "#81A1C1",
  provider: "#8FBCBB",
  context: "#88C0D0",
  logoPrimary: "#88C0D0",
  logoSecondary: "#81A1C1",
  logoShadow: "#434C5E",
} satisfies Theme;

export const DRACULA_THEME = {
  bg: "#1E1F29",
  surface: "#282A36",
  surfaceMuted: "#21222C",
  border: "#44475A",
  borderFocused: "#BD93F9",
  accent: "#FF79C6",
  accentMuted: "#BF93F9",
  text: "#F8F8F2",
  textMuted: "#BFBFBF",
  textDim: "#6272A4",
  success: "#50FA7B",
  warning: "#F1FA8C",
  error: "#FF5555",
  info: "#8BE9FD",
  command: "#FF79C6",
  prompt: "#8BE9FD",
  model: "#BD93F9",
  provider: "#8BE9FD",
  context: "#8BE9FD",
  logoPrimary: "#BD93F9",
  logoSecondary: "#FF79C6",
  logoShadow: "#44475A",
} satisfies Theme;

export const GRUVBOX_THEME = {
  bg: "#1D2021",
  surface: "#282828",
  surfaceMuted: "#242424",
  border: "#3C3836",
  borderFocused: "#FABD2F",
  accent: "#FABD2F",
  accentMuted: "#D79921",
  text: "#EBDBB2",
  textMuted: "#A89984",
  textDim: "#665C54",
  success: "#B8BB26",
  warning: "#FE8019",
  error: "#FB4934",
  info: "#83A598",
  command: "#FABD2F",
  prompt: "#83A598",
  model: "#83A598",
  provider: "#8EC07C",
  context: "#83A598",
  logoPrimary: "#FABD2F",
  logoSecondary: "#B8BB26",
  logoShadow: "#504945",
} satisfies Theme;

export const OCEAN_THEME = {
  bg: "#030712",
  surface: "#0F172A",
  surfaceMuted: "#0A0F1D",
  border: "#1E293B",
  borderFocused: "#38BDF8",
  accent: "#0EA5E9",
  accentMuted: "#0284C7",
  text: "#F0F9FF",
  textMuted: "#7DD3FC",
  textDim: "#0369A1",
  success: "#10B981",
  warning: "#F59E0B",
  error: "#F43F5E",
  info: "#0EA5E9",
  command: "#0EA5E9",
  prompt: "#38BDF8",
  model: "#7DD3FC",
  provider: "#38BDF8",
  context: "#38BDF8",
  logoPrimary: "#0EA5E9",
  logoSecondary: "#38BDF8",
  logoShadow: "#1E3A70",
} satisfies Theme;

// ─── Theme registry ───────────────────────────────────────────────────────────

export const THEMES: Record<string, Theme> = {
  dark: DARK_THEME,
  purple: PURPLE_THEME,
  mono: MONO_THEME,
  black: BLACK_THEME,
  nordic: NORDIC_THEME,
  dracula: DRACULA_THEME,
  gruvbox: GRUVBOX_THEME,
  ocean: OCEAN_THEME,
};

// ─── Context & hook ───────────────────────────────────────────────────────────

const ThemeContext = createContext<Theme>(DARK_THEME);

interface ThemeProviderProps {
  theme?: string;
  customTheme?: Partial<Theme>;
  children: ReactNode;
}

export function ThemeProvider({ theme: themeName = "dark", customTheme, children }: ThemeProviderProps) {
  renderDebug.useLifecycleDebug("ThemeProvider", {
    themeName,
    customTheme: Boolean(customTheme),
  });
  renderDebug.useRenderDebug("ThemeProvider", {
    themeName,
    customTheme: Boolean(customTheme),
  });
  const baseTheme = THEMES[themeName] || DARK_THEME;
  const activeTheme = themeName === "custom" ? { ...DARK_THEME, ...customTheme } : baseTheme;
  return (
    <ThemeContext.Provider value={activeTheme as Theme}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
