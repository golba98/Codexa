import type { Screen } from "../session/types.js";

export const FOCUS_IDS = {
  composer: "composer",
  backendPicker: "backend-picker",
  modelPicker: "model-picker",
  modePicker: "mode-picker",
  reasoningPicker: "reasoning-picker",
  themePicker: "theme-picker",
  authPanel: "auth-panel",
} as const;

export type FocusTargetId = (typeof FOCUS_IDS)[keyof typeof FOCUS_IDS];

export function getFocusTargetForScreen(screen: Screen): FocusTargetId {
  switch (screen) {
    case "backend-picker":
      return FOCUS_IDS.backendPicker;
    case "model-picker":
      return FOCUS_IDS.modelPicker;
    case "mode-picker":
      return FOCUS_IDS.modePicker;
    case "reasoning-picker":
      return FOCUS_IDS.reasoningPicker;
    case "theme-picker":
      return FOCUS_IDS.themePicker;
    case "auth-panel":
      return FOCUS_IDS.authPanel;
    case "main":
    default:
      return FOCUS_IDS.composer;
  }
}
