import React from "react";
import { AVAILABLE_MODELS } from "../config/settings.js";
import { FOCUS_IDS } from "./focus.js";
import { SelectionPanel } from "./SelectionPanel.js";

interface ModelPickerProps {
  currentModel: string;
  onSelect: (model: string) => void;
  onCancel: () => void;
}

export function ModelPicker({ currentModel, onSelect, onCancel }: ModelPickerProps) {
  const items = AVAILABLE_MODELS.map((model) => ({
    label: model === currentModel ? `${model}  ✓` : model,
    value: model,
  }));

  return (
    <SelectionPanel
      focusId={FOCUS_IDS.modelPicker}
      title="Select model"
      subtitle="Use arrow keys and Enter. Esc closes the panel."
      items={items}
      onSelect={onSelect}
      onCancel={onCancel}
    />
  );
}
