import React from "react";
import { AVAILABLE_THEMES, formatThemeLabel } from "../config/settings.js";
import { FOCUS_IDS } from "./focus.js";
import { SelectionPanel } from "./SelectionPanel.js";

interface ThemePickerProps {
  currentTheme: string;
  onSelect: (themeId: string) => void;
  onHighlight?: (themeId: string) => void;
  onCancel: () => void;
}

export function ThemePicker({ currentTheme, onSelect, onHighlight, onCancel }: ThemePickerProps) {
  const items = AVAILABLE_THEMES.map((theme) => ({
    label: theme.id === currentTheme ? `${formatThemeLabel(theme.id)}  ✓` : formatThemeLabel(theme.id),
    value: theme.id,
  }));

  return (
    <SelectionPanel
      focusId={FOCUS_IDS.themePicker}
      title="Select visual theme"
      subtitle="Use arrow keys and Enter to switch. Esc closes the panel."
      items={items}
      limit={8}
      onSelect={onSelect}
      onHighlight={onHighlight}
      onCancel={onCancel}
    />
  );
}
