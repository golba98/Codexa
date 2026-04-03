import type { Screen } from "../session/types.js";

export interface ThemeSelectionState {
  committedTheme: string;
  previewTheme: string | null;
}

export function getDisplayedThemeName(state: ThemeSelectionState): string {
  return state.previewTheme ?? state.committedTheme;
}

export function previewThemeSelection(
  state: ThemeSelectionState,
  nextTheme: string,
): ThemeSelectionState {
  return {
    ...state,
    previewTheme: nextTheme,
  };
}

export function commitThemeSelection(
  state: ThemeSelectionState,
  nextTheme: string,
): ThemeSelectionState {
  return {
    committedTheme: nextTheme,
    previewTheme: null,
  };
}

export function cancelThemeSelection(state: ThemeSelectionState): ThemeSelectionState {
  return {
    committedTheme: state.committedTheme,
    previewTheme: null,
  };
}

export function shouldBumpComposerInstance(previousScreen: Screen, nextScreen: Screen): boolean {
  return previousScreen !== "main" && nextScreen === "main";
}
