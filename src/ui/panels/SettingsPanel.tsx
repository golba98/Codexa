import React, { useMemo, useState } from "react";
import { Box, Text, useFocus, useInput } from "ink";
import type { SettingDefinition } from "../../config/settings.js";
import type { FocusTargetId } from "../input/focus.js";
import { useTheme } from "../theme.js";

export interface SettingsPanelProps<TKey extends string> {
  focusId: FocusTargetId;
  title?: string;
  settings: readonly SettingDefinition<TKey, string>[];
  values: Record<TKey, string>;
  onSave: (values: Record<TKey, string>) => void;
  onCancel: () => void;
}

function cycleOption<TKey extends string>(
  definition: SettingDefinition<TKey, string>,
  currentValue: string,
  direction: -1 | 1,
): string {
  const currentIndex = definition.options.findIndex((option) => option.value === currentValue);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIndex + direction + definition.options.length) % definition.options.length;
  return definition.options[nextIndex]?.value ?? currentValue;
}

export function SettingsPanel<TKey extends string>({
  focusId,
  title = "Settings",
  settings,
  values,
  onSave,
  onCancel,
}: SettingsPanelProps<TKey>) {
  const theme = useTheme();
  const { isFocused } = useFocus({ id: focusId, autoFocus: true });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [draftValues, setDraftValues] = useState<Record<TKey, string>>(() => ({ ...values }));

  const activeSetting = settings[selectedIndex] ?? settings[0];
  const subtitle = useMemo(() => {
    const instructions = "↑↓ setting  ←→ option  Esc to close · Enter to confirm";
    if (!activeSetting?.description) {
      return instructions;
    }

    return `${instructions}\n${activeSetting.description}`;
  }, [activeSetting]);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      onSave(draftValues);
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((current) => Math.max(0, current - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((current) => Math.min(settings.length - 1, current + 1));
      return;
    }

    if (key.leftArrow || key.rightArrow) {
      const direction: -1 | 1 = key.leftArrow ? -1 : 1;
      const definition = settings[selectedIndex];
      if (!definition) {
        return;
      }

      setDraftValues((current) => ({
        ...current,
        [definition.key]: cycleOption(definition, current[definition.key], direction),
      }));
      return;
    }

    if (!input || key.ctrl || key.meta) {
      return;
    }
  }, { isActive: isFocused });

  return (
    <Box flexDirection="column" width="100%" marginTop={1}>
      <Box
        borderStyle="round"
        borderColor={theme.border}
        paddingX={2}
        paddingY={1}
        width="100%"
        flexDirection="column"
      >
        <Box>
          <Text color={theme.accent} bold>{title}  </Text>
          <Text color={theme.textMuted}>{subtitle.split("\n")[0]}</Text>
        </Box>
        {activeSetting?.description && (
          <Box marginTop={1}>
            <Text color={theme.textDim}>{activeSetting.description}</Text>
          </Box>
        )}
      </Box>

      <Box
        borderStyle="round"
        borderColor={theme.borderFocused}
        paddingX={2}
        paddingY={1}
        marginTop={1}
        width="100%"
        flexDirection="column"
      >
        {settings.map((setting, index) => {
          const isSelectedRow = index === selectedIndex;
          const currentValue = draftValues[setting.key];

          return (
            <Box key={setting.key} flexDirection="row" width="100%">
              <Box width={3}>
                <Text color={isSelectedRow ? theme.accent : theme.textDim}>{isSelectedRow ? "▸ " : "  "}</Text>
              </Box>
              <Box width={20}>
                <Text color={isSelectedRow ? theme.text : theme.textMuted} bold={isSelectedRow}>
                  {setting.label}
                </Text>
              </Box>
              <Box flexDirection="row" flexWrap="wrap" flexGrow={1}>
                {setting.options.map((option, optionIndex) => {
                  const isActiveOption = option.value === currentValue;
                  const optionText = isActiveOption ? `[${option.label}]` : option.label;
                  return (
                    <Text
                      key={option.value}
                      color={isActiveOption ? (isSelectedRow ? theme.accent : theme.text) : theme.textDim}
                      bold={isActiveOption}
                    >
                      {optionIndex > 0 ? "  " : ""}
                      {optionText}
                    </Text>
                  );
                })}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
