import React from "react";
import { type CodexModelCapability } from "../core/codexModelCapabilities.js";
import { FOCUS_IDS } from "./focus.js";
import { SelectionPanel } from "./SelectionPanel.js";

interface ModelPickerProps {
  models: readonly CodexModelCapability[];
  currentModel: string;
  onSelect: (model: string) => void;
  onCancel: () => void;
}

export function ModelPicker({ models, currentModel, onSelect, onCancel }: ModelPickerProps) {
  const items = models.map((model) => {
    const label = model.label === model.model ? model.model : `${model.label} (${model.model})`;
    return {
      label: model.model === currentModel || model.id === currentModel ? `${label}  ✓` : label,
      value: model.model,
    };
  });

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
