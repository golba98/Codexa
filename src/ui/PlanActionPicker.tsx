import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useFocus, useInput, useStdin } from "ink";
import { FOCUS_IDS } from "./focus.js";
import { useTheme } from "./theme.js";

export type PlanActionValue = "implement" | "revise" | "cancel";

const ACTION_ROWS: Array<{ key: string; label: string; value: PlanActionValue }> = [
  { key: "I", label: "Implement changes", value: "implement" },
  { key: "U", label: "Update plan", value: "revise" },
];
const VERTICAL_LAYOUT_BREAKPOINT = 56;

interface PlanActionPickerProps {
  cols?: number;
  onSelect: (value: PlanActionValue) => void;
  onCancel: () => void;
}

export function measurePlanActionPickerRows(cols = 80): number {
  return cols < VERTICAL_LAYOUT_BREAKPOINT ? 3 : 1;
}

export function PlanActionPicker({
  cols = 80,
  onSelect,
  onCancel,
}: PlanActionPickerProps) {
  const theme = useTheme();
  const { isFocused } = useFocus({ id: FOCUS_IDS.composer, autoFocus: true });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { stdin } = useStdin();
  const mouseEventTickRef = useRef(false);
  const mouseEventTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vertical = cols < VERTICAL_LAYOUT_BREAKPOINT;

  useEffect(() => {
    const handleRawInput = (chunk: Buffer | string) => {
      const raw = typeof chunk === "string" ? chunk : chunk.toString();
      if (/\u001b\[<\d+;\d+;\d+[Mm]/.test(raw) || /\u001b\[M/.test(raw)) {
        mouseEventTickRef.current = true;
        if (mouseEventTimeoutRef.current) clearTimeout(mouseEventTimeoutRef.current);
        mouseEventTimeoutRef.current = setTimeout(() => {
          mouseEventTickRef.current = false;
        }, 32);
      }
    };
    stdin.on("data", handleRawInput);
    return () => {
      stdin.off("data", handleRawInput);
      if (mouseEventTimeoutRef.current) clearTimeout(mouseEventTimeoutRef.current);
    };
  }, [stdin]);

  useInput((input, key) => {
    if (mouseEventTickRef.current) return;
    if (key.return) {
      onSelect(ACTION_ROWS[selectedIndex]?.value ?? "implement");
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow || key.leftArrow || (key.shift && key.tab)) {
      setSelectedIndex((current) => (current + ACTION_ROWS.length - 1) % ACTION_ROWS.length);
      return;
    }

    if (key.downArrow || key.rightArrow || key.tab) {
      setSelectedIndex((current) => (current + 1) % ACTION_ROWS.length);
      return;
    }

    if (input.length === 1) {
      const lower = input.toLowerCase();
      if (lower === "i") { onSelect("implement"); return; }
      if (lower === "u") { onSelect("revise"); return; }
    }
  }, { isActive: isFocused });

  const renderAction = (row: (typeof ACTION_ROWS)[number], index: number) => {
    const selected = index === selectedIndex;
    return (
      <Text key={row.value}>
        <Text color={selected ? theme.ACCENT : theme.DIM}>
          {selected ? "› " : vertical ? "  " : ""}
        </Text>
        <Text color={selected ? theme.TEXT : theme.MUTED}>
          {`[${row.key}] ${row.label}`}
        </Text>
      </Text>
    );
  };

  if (vertical) {
    return (
      <Box flexDirection="column">
        <Text color={isFocused ? theme.TEXT : theme.MUTED} bold={isFocused}>Plan ready</Text>
        {ACTION_ROWS.map(renderAction)}
      </Box>
    );
  }

  return (
    <Text>
      <Text color={isFocused ? theme.TEXT : theme.MUTED} bold={isFocused}>Plan ready</Text>
      <Text color={theme.DIM}>{"  "}</Text>
      {ACTION_ROWS.map((row, index) => (
        <React.Fragment key={row.value}>
          {renderAction(row, index)}
          {index < ACTION_ROWS.length - 1 && <Text color={theme.DIM}>{"   "}</Text>}
        </React.Fragment>
      ))}
    </Text>
  );
}
