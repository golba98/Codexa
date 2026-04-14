import React from "react";
import {
  PERMISSION_PRESETS,
  areRuntimePoliciesEqual,
  formatRuntimePolicySummary,
  type RuntimePolicy,
} from "../config/settings.js";
import { FOCUS_IDS } from "./focus.js";
import { SelectionPanel } from "./SelectionPanel.js";

interface PermissionsPickerProps {
  currentPolicy: RuntimePolicy;
  onSelectPreset: (presetId: string) => void;
  onCancel: () => void;
}

export function PermissionsPicker({
  currentPolicy,
  onSelectPreset,
  onCancel,
}: PermissionsPickerProps) {
  const items = PERMISSION_PRESETS.map((preset) => {
    const active = areRuntimePoliciesEqual(currentPolicy, preset.policy);
    const summary = formatRuntimePolicySummary(preset.policy);
    return {
      label: active ? `${preset.label}  ✓  ${summary}` : `${preset.label}  ${summary}`,
      value: preset.id,
    };
  });

  return (
    <SelectionPanel
      focusId={FOCUS_IDS.permissionsPicker}
      title="Select permissions"
      subtitle="Permission presets change Codex approval policy and sandbox behavior for real runs."
      items={items}
      onSelect={onSelectPreset}
      onCancel={onCancel}
    />
  );
}
