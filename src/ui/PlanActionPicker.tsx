import React from "react";
import { Box, Text, useFocus, useInput } from "ink";
import SelectInput from "ink-select-input";
import { FOCUS_IDS } from "./focus.js";
import { useTheme } from "./theme.js";

export type PlanActionValue = "implement" | "revise" | "constraints" | "view_plan_file" | "cancel";

function getPlanActionItems(hasPlanFile: boolean): Array<{ label: string; value: PlanActionValue }> {
  const items: Array<{ label: string; value: PlanActionValue }> = [
    { label: "Implement plan  I", value: "implement" },
    { label: "Revise plan  R", value: "revise" },
    { label: "Add constraints  A", value: "constraints" },
  ];

  if (hasPlanFile) {
    items.push({ label: "View plan file  V", value: "view_plan_file" });
  }

  items.push({ label: "Cancel  Esc", value: "cancel" });
  return items;
}

interface PlanActionPickerProps {
  hasPlanFile?: boolean;
  onSelect: (value: PlanActionValue) => void;
  onCancel: () => void;
}

export function measurePlanActionPickerRows(hasPlanFile = false): number {
  return getPlanActionItems(hasPlanFile).length + 6;
}

function PlanActionIndicator({ isSelected = false }: { isSelected?: boolean }) {
  const theme = useTheme();
  return (
    <Box marginRight={1}>
      <Text color={isSelected ? theme.ACCENT : undefined}>
        {isSelected ? "›" : " "}
      </Text>
    </Box>
  );
}

function PlanActionItem({ isSelected = false, label }: { isSelected?: boolean; label: string }) {
  const theme = useTheme();
  return (
    <Text color={isSelected ? theme.TEXT : theme.MUTED} bold={isSelected}>
      {label}
    </Text>
  );
}

export function PlanActionPicker({
  hasPlanFile = false,
  onSelect,
  onCancel,
}: PlanActionPickerProps) {
  const theme = useTheme();
  const items = React.useMemo(() => getPlanActionItems(hasPlanFile), [hasPlanFile]);
  const { isFocused } = useFocus({ id: FOCUS_IDS.composer, autoFocus: true });

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    const lowerInput = input.toLowerCase();
    if (lowerInput === "i") {
      onSelect("implement");
      return;
    }
    if (lowerInput === "r") {
      onSelect("revise");
      return;
    }
    if (lowerInput === "a") {
      onSelect("constraints");
      return;
    }
    if (lowerInput === "v" && hasPlanFile) {
      onSelect("view_plan_file");
    }
  }, { isActive: isFocused });

  return (
    <Box flexDirection="column" width="100%" marginTop={1} paddingX={1}>
      <Box
        flexDirection="column"
        width="100%"
        borderStyle="round"
        borderColor={isFocused ? theme.BORDER_ACTIVE : theme.BORDER_SUBTLE}
        paddingX={1}
      >
        <Box justifyContent="space-between" width="100%">
          <Text color={theme.TEXT} bold>Plan review</Text>
          <Text color={isFocused ? theme.ACCENT : theme.MUTED}>
            {isFocused ? "ready" : "waiting"}
          </Text>
        </Box>
        <Text color={theme.MUTED}>
          Enter confirm  Up/Down move  Esc cancel  I/R/A hotkeys
        </Text>
        <Box marginTop={1}>
        <SelectInput
          items={items}
          isFocused={isFocused}
          limit={items.length}
          indicatorComponent={PlanActionIndicator}
          itemComponent={PlanActionItem}
          onSelect={(item) => onSelect(item.value as PlanActionValue)}
        />
        </Box>
      </Box>
    </Box>
  );
}
