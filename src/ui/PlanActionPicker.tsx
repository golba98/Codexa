import React from "react";
import { FOCUS_IDS } from "./focus.js";
import { SelectionPanel } from "./SelectionPanel.js";

export type PlanActionValue = "implement" | "revise" | "constraints" | "cancel";

const PLAN_ACTION_ITEMS: Array<{ label: string; value: PlanActionValue }> = [
  { label: "Implement plan", value: "implement" },
  { label: "Revise plan", value: "revise" },
  { label: "Add constraints / instructions", value: "constraints" },
  { label: "Cancel", value: "cancel" },
];

interface PlanActionPickerProps {
  onSelect: (value: PlanActionValue) => void;
  onCancel: () => void;
}

export function measurePlanActionPickerRows(): number {
  return PLAN_ACTION_ITEMS.length + 11;
}

export function PlanActionPicker({ onSelect, onCancel }: PlanActionPickerProps) {
  return (
    <SelectionPanel
      focusId={FOCUS_IDS.composer}
      title="Review plan"
      subtitle="Choose how to proceed. Enter confirms, Esc cancels."
      items={PLAN_ACTION_ITEMS}
      limit={PLAN_ACTION_ITEMS.length}
      onSelect={(value) => onSelect(value as PlanActionValue)}
      onCancel={onCancel}
    />
  );
}
