import React from "react";
import { FOCUS_IDS } from "./focus.js";
import { SelectionPanel } from "./SelectionPanel.js";

export type PlanActionValue = "implement" | "revise" | "constraints" | "view_plan_file" | "cancel";

function getPlanActionItems(hasPlanFile: boolean): Array<{ label: string; value: PlanActionValue }> {
  const items: Array<{ label: string; value: PlanActionValue }> = [
    { label: "Implement plan", value: "implement" },
    { label: "Revise plan", value: "revise" },
    { label: "Add constraints / instructions", value: "constraints" },
  ];

  if (hasPlanFile) {
    items.push({ label: "View plan file", value: "view_plan_file" });
  }

  items.push({ label: "Cancel", value: "cancel" });
  return items;
}

interface PlanActionPickerProps {
  hasPlanFile?: boolean;
  onSelect: (value: PlanActionValue) => void;
  onCancel: () => void;
}

export function measurePlanActionPickerRows(hasPlanFile = false): number {
  return getPlanActionItems(hasPlanFile).length + 11;
}

export function PlanActionPicker({
  hasPlanFile = false,
  onSelect,
  onCancel,
}: PlanActionPickerProps) {
  const items = React.useMemo(() => getPlanActionItems(hasPlanFile), [hasPlanFile]);

  return (
    <SelectionPanel
      focusId={FOCUS_IDS.composer}
      title="Review plan"
      subtitle="Choose how to proceed. Enter confirms, Esc cancels."
      items={items}
      limit={items.length}
      onSelect={(value) => onSelect(value as PlanActionValue)}
      onCancel={onCancel}
    />
  );
}
