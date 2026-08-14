import { AVAILABLE_MODES } from "../../config/settings.js";
import { FOCUS_IDS } from "../input/focus.js";
import { SelectionPanel } from "./SelectionPanel.js";

interface ModePickerProps {
  currentMode: string;
  planMode?: boolean;
  onSelect: (mode: string) => void;
  onCancel: () => void;
}

export function ModePicker({ currentMode, planMode = false, onSelect, onCancel }: ModePickerProps) {
  const items = [
    { label: planMode ? "Plan  ✓" : "Plan", value: "plan" },
    ...AVAILABLE_MODES.map((mode) => ({
    label: mode.key === currentMode ? `${mode.label}  ✓` : mode.label,
    value: mode.key,
    })),
  ];

  return (
    <SelectionPanel
      focusId={FOCUS_IDS.modePicker}
      title="Select mode"
      subtitle="Plan inspects without changing files; execution modes control implementation access."
      items={items}
      onSelect={onSelect}
      onCancel={onCancel}
    />
  );
}
