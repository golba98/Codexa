import React, { useEffect, useRef, useState } from "react";
import { Text, useFocus, useInput, useStdin } from "ink";
import { FOCUS_IDS } from "./focus.js";
import { useTheme } from "./theme.js";
import { DashCard } from "./DashCard.js";

export type PlanActionValue = "implement" | "revise" | "cancel";

const ACTION_ROWS: Array<{ key: string; label: string; value: PlanActionValue }> = [
  { key: "I", label: "Implement changes", value: "implement" },
  { key: "U", label: "Update plan", value: "revise" },
];

interface PlanActionPickerProps {
  cols?: number;
  onSelect: (value: PlanActionValue) => void;
  onCancel: () => void;
}

export function measurePlanActionPickerRows(): number {
  // 2 action rows + 2 DashCard border rows + 1 marginTop = 5 total
  return 5;
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

  return (
    <DashCard
      cols={cols}
      title="Plan ready"
      borderColor={isFocused ? theme.BORDER_ACTIVE : theme.BORDER_SUBTLE}
    >
      {ACTION_ROWS.map((row, index) => (
        <Text key={row.value}>
          <Text color={index === selectedIndex ? theme.ACCENT : theme.DIM}>
            {index === selectedIndex ? "  › " : "    "}
          </Text>
          <Text color={index === selectedIndex ? theme.TEXT : theme.MUTED}>
            {`${row.key}  ${row.label}`}
          </Text>
        </Text>
      ))}
    </DashCard>
  );
}
