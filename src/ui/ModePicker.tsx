import React from "react";
import { AVAILABLE_MODES } from "../config/settings.js";
import { FOCUS_IDS } from "./focus.js";
import { SelectionPanel } from "./SelectionPanel.js";

interface ModePickerProps {
  currentMode: string;
  onSelect: (mode: string) => void;
  onCancel: () => void;
}

export function ModePicker({ currentMode, onSelect, onCancel }: ModePickerProps) {
  const items = AVAILABLE_MODES.map((mode) => ({
    label: mode.key === currentMode ? `${mode.label}  ✓` : mode.label,
    value: mode.key,
  }));

  return (
    <SelectionPanel
      focusId={FOCUS_IDS.modePicker}
      title="Select mode"
      subtitle="Execution mode controls how aggressive the runner can be."
      items={items}
      onSelect={onSelect}
      onCancel={onCancel}
    />
  );
}
