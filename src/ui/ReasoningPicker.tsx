import React from "react";
import {
  AVAILABLE_REASONING_LEVELS,
  formatReasoningLabel,
  getRecommendedReasoningForModel,
  type AvailableModel,
} from "../config/settings.js";
import { FOCUS_IDS } from "./focus.js";
import { SelectionPanel } from "./SelectionPanel.js";

interface ReasoningPickerProps {
  currentReasoning: string;
  currentModel: AvailableModel;
  onSelect: (reasoning: string) => void;
  onCancel: () => void;
}

export function ReasoningPicker({
  currentReasoning,
  currentModel,
  onSelect,
  onCancel,
}: ReasoningPickerProps) {
  const recommended = getRecommendedReasoningForModel(currentModel);

  const items = AVAILABLE_REASONING_LEVELS.map((reasoning) => ({
    label: reasoning.id === currentReasoning ? `${reasoning.label}  ✓` : reasoning.label,
    value: reasoning.id,
  }));

  return (
    <SelectionPanel
      focusId={FOCUS_IDS.reasoningPicker}
      title="Select reasoning level"
      subtitle={`Suggested for ${currentModel}: ${formatReasoningLabel(recommended)}`}
      items={items}
      onSelect={onSelect}
      onCancel={onCancel}
    />
  );
}
