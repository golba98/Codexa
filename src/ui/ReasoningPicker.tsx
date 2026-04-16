import React from "react";
import { type ReasoningEffortCapability } from "../core/codexModelCapabilities.js";
import { formatReasoningLabel } from "../config/settings.js";
import { FOCUS_IDS } from "./focus.js";
import { SelectionPanel } from "./SelectionPanel.js";

interface ReasoningPickerProps {
  currentReasoning: string;
  currentModel: string;
  reasoningLevels: readonly ReasoningEffortCapability[];
  defaultReasoning: string | null;
  onSelect: (reasoning: string) => void;
  onCancel: () => void;
}

export function ReasoningPicker({
  currentReasoning,
  currentModel,
  reasoningLevels,
  defaultReasoning,
  onSelect,
  onCancel,
}: ReasoningPickerProps) {
  const items = reasoningLevels.map((reasoning) => ({
    label: reasoning.id === currentReasoning ? `${reasoning.label}  ✓` : reasoning.label,
    value: reasoning.id,
  }));

  const subtitle = defaultReasoning
    ? `Suggested for ${currentModel}: ${formatReasoningLabel(defaultReasoning)}`
    : `Detected levels for ${currentModel}`;

  return (
    <SelectionPanel
      focusId={FOCUS_IDS.reasoningPicker}
      title="Select reasoning level"
      subtitle={subtitle}
      items={items}
      onSelect={onSelect}
      onCancel={onCancel}
    />
  );
}
