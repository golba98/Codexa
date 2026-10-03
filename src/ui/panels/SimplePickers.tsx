import {
  AVAILABLE_MODES,
  AVAILABLE_THEMES,
  formatReasoningLabel,
  formatThemeLabel,
} from "../../config/settings.js";
import type { ReasoningEffortCapability } from "../../core/models/codexModelCapabilities.js";
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

interface ThemePickerProps {
  currentTheme: string;
  onSelect: (themeId: string) => void;
  onHighlight?: (themeId: string) => void;
  onCancel: () => void;
}

export function ThemePicker({ currentTheme, onSelect, onHighlight, onCancel }: ThemePickerProps) {
  const items = AVAILABLE_THEMES.map((theme) => ({
    label:
      theme.id === currentTheme ? `${formatThemeLabel(theme.id)}  ✓` : formatThemeLabel(theme.id),
    value: theme.id,
  }));

  return (
    <SelectionPanel
      focusId={FOCUS_IDS.themePicker}
      title="Select visual theme"
      subtitle="Use arrow keys and Enter to switch. Esc closes the panel."
      items={items}
      limit={8}
      initialValue={currentTheme}
      onSelect={onSelect}
      onHighlight={onHighlight}
      onCancel={onCancel}
    />
  );
}

interface ReasoningPickerProps {
  currentReasoning: string;
  currentModel: string;
  reasoningLevels: readonly ReasoningEffortCapability[];
  defaultReasoning: string | null;
  sourceLabel?: string | null;
  onSelect: (reasoning: string) => void;
  onCancel: () => void;
}

export function ReasoningPicker({
  currentReasoning,
  currentModel,
  reasoningLevels,
  defaultReasoning,
  sourceLabel,
  onSelect,
  onCancel,
}: ReasoningPickerProps) {
  const items = reasoningLevels.map((reasoning) => ({
    label: reasoning.id === currentReasoning ? `${reasoning.label}  ✓` : reasoning.label,
    value: reasoning.id,
  }));

  const baseSubtitle = defaultReasoning
    ? `Suggested for ${currentModel}: ${formatReasoningLabel(defaultReasoning)}`
    : `Detected levels for ${currentModel}`;
  const subtitle = sourceLabel ? `${baseSubtitle} · ${sourceLabel}` : baseSubtitle;

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
