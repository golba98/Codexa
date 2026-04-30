import React from "react";
import { Box, Text, useFocus, useInput, useStdin } from "ink";
import SelectInput from "ink-select-input";
import { FOCUS_IDS } from "./focus.js";
import { useTheme } from "./theme.js";

export type PlanActionValue = "implement" | "revise" | "constraints" | "view_plan_file" | "cancel";

function getPlanActionItems(hasPlanFile: boolean): Array<{ label: string; value: PlanActionValue }> {
  const items: Array<{ label: string; value: PlanActionValue }> = [
    { label: "Implement plan", value: "implement" },
    { label: "Revise plan", value: "revise" },
    { label: "Add constraints / instructions", value: "constraints" },
  ];

  if (hasPlanFile) {
    items.push({ label: "View plan file", value: "view_plan_file" });
  }

  items.push({ label: "Cancel", value: "cancel" });
  return items;
}

interface PlanActionPickerProps {
  hasPlanFile?: boolean;
  scrollablePlan?: boolean;
  onFocusPlan?: () => void;
  onSelect: (value: PlanActionValue) => void;
  onCancel: () => void;
}

export function measurePlanActionPickerRows(hasPlanFile = false): number {
  return getPlanActionItems(hasPlanFile).length + 4;
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
  return <Text color={isSelected ? theme.TEXT : theme.MUTED}>{label}</Text>;
}

export function PlanActionPicker({
  hasPlanFile = false,
  scrollablePlan = false,
  onFocusPlan,
  onSelect,
  onCancel,
}: PlanActionPickerProps) {
  const theme = useTheme();
  const items = React.useMemo(() => getPlanActionItems(hasPlanFile), [hasPlanFile]);
  const { isFocused } = useFocus({ id: FOCUS_IDS.composer, autoFocus: true });
  const { stdin } = useStdin();

  React.useEffect(() => {
    if (!scrollablePlan || !isFocused) return;

    const handleRawInput = (chunk: Buffer | string) => {
      if (chunk.toString("utf8") === "\t") {
        onFocusPlan?.();
      }
    };

    stdin.on("data", handleRawInput);
    return () => {
      stdin.off("data", handleRawInput);
    };
  }, [isFocused, onFocusPlan, scrollablePlan, stdin]);

  useInput((input, key) => {
    if ((key.tab || input === "\t" || (key.ctrl && input === "i")) && scrollablePlan) {
      onFocusPlan?.();
      return;
    }
    if (key.escape) onCancel();
  }, { isActive: isFocused });

  return (
    <Box flexDirection="column" width="100%" marginTop={1} paddingX={2}>
      <Text color={theme.MUTED}>
        {scrollablePlan
          ? "Tab switches focus. PageUp/PageDown scroll plan. Enter confirms."
          : "Choose how to proceed. Enter confirms, Esc cancels."}
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
  );
}
