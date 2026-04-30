import type { Screen } from "../session/types.js";

export const FOCUS_IDS = {
  composer: "composer",
  planReviewPanel: "plan-review-panel",
  backendPicker: "backend-picker",
  modelPicker: "model-picker",
  modePicker: "mode-picker",
  reasoningPicker: "reasoning-picker",
  themePicker: "theme-picker",
  settingsPanel: "settings-panel",
  authPanel: "auth-panel",
  permissionsPanel: "permissions-panel",
  permissionsApprovalPicker: "permissions-approval-picker",
  permissionsSandboxPicker: "permissions-sandbox-picker",
  permissionsNetworkPicker: "permissions-network-picker",
  permissionsAddWritableRoot: "permissions-add-writable-root",
  permissionsRemoveWritableRoot: "permissions-remove-writable-root",
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
    case "settings-panel":
      return FOCUS_IDS.settingsPanel;
    case "auth-panel":
      return FOCUS_IDS.authPanel;
    case "permissions-panel":
      return FOCUS_IDS.permissionsPanel;
    case "permissions-approval-picker":
      return FOCUS_IDS.permissionsApprovalPicker;
    case "permissions-sandbox-picker":
      return FOCUS_IDS.permissionsSandboxPicker;
    case "permissions-network-picker":
      return FOCUS_IDS.permissionsNetworkPicker;
    case "permissions-add-writable-root":
      return FOCUS_IDS.permissionsAddWritableRoot;
    case "permissions-remove-writable-root":
      return FOCUS_IDS.permissionsRemoveWritableRoot;
    case "main":
    default:
      return FOCUS_IDS.composer;
  }
}
