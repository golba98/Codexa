import React, { useState } from "react";
import { Text, useFocus, useInput } from "ink";
import { FOCUS_IDS } from "./focus.js";
import { useTheme } from "./theme.js";
import { DashCard } from "./DashCard.js";

export type PlanActionValue = "implement" | "revise" | "constraints" | "cancel";

const ACTION_ROWS: Array<{ key: string; label: string; value: PlanActionValue }> = [
  { key: "I", label: "Implement plan", value: "implement" },
  { key: "R", label: "Request changes", value: "revise" },
  { key: "A", label: "Add constraints", value: "constraints" },
  { key: "Esc", label: "Cancel", value: "cancel" },
];

const IMPLEMENT_KEYWORDS = new Set([
  "yes", "approve", "approved", "ok", "go", "lgtm", "proceed",
  "looks good", "ship it", "do it",
]);

const CANCEL_KEYWORDS = new Set([
  "cancel", "no", "quit", "n", "abort", "stop", "exit", "nope",
]);

function parseDecisionText(text: string): "implement" | "cancel" | "revise" {
  const normalized = text.trim().toLowerCase();
  if (IMPLEMENT_KEYWORDS.has(normalized)) return "implement";
  if (CANCEL_KEYWORDS.has(normalized)) return "cancel";
  return "revise";
}

interface PlanActionPickerProps {
  cols?: number;
  onSelect: (value: PlanActionValue) => void;
  onSelectWithText?: (mode: "revise" | "constraints", text: string) => void;
  onCancel: () => void;
}

export function measurePlanActionPickerRows(): number {
  // 4 action rows + 1 blank + 1 input line = 6 content rows
  // + 2 DashCard border rows + 1 marginTop = 9 total
  return 9;
}

export function PlanActionPicker({
  cols = 80,
  onSelect,
  onSelectWithText,
  onCancel,
}: PlanActionPickerProps) {
  const theme = useTheme();
  const { isFocused } = useFocus({ id: FOCUS_IDS.composer, autoFocus: true });
  const [inputText, setInputText] = useState("");

  useInput((input, key) => {
    if (key.return) {
      if (inputText.length > 0) {
        const decision = parseDecisionText(inputText);
        if (decision === "implement") {
          onSelect("implement");
        } else if (decision === "cancel") {
          onCancel();
        } else {
          if (onSelectWithText) {
            onSelectWithText("revise", inputText);
          } else {
            onSelect("revise");
          }
        }
      }
      return;
    }

    if (key.escape) {
      if (inputText.length > 0) {
        setInputText("");
      } else {
        onCancel();
      }
      return;
    }

    if (key.backspace || key.delete) {
      setInputText((prev) => prev.slice(0, -1));
      return;
    }

    // Single-key shortcuts only when input is empty
    if (inputText.length === 0 && input.length === 1) {
      const lower = input.toLowerCase();
      if (lower === "i") { onSelect("implement"); return; }
      if (lower === "r") { onSelect("revise"); return; }
      if (lower === "a") { onSelect("constraints"); return; }
    }

    // Accumulate text for natural input
    if (input.length > 0 && !key.ctrl && !key.meta) {
      setInputText((prev) => prev + input);
    }
  }, { isActive: isFocused });

  return (
    <DashCard
      cols={cols}
      title="Decision"
      borderColor={isFocused ? theme.BORDER_ACTIVE : theme.BORDER_SUBTLE}
    >
      {ACTION_ROWS.map((row) => (
        <Text key={row.value}>{"  " + row.key.padEnd(3) + "  " + row.label}</Text>
      ))}
      <Text> </Text>
      <Text>
        {"  > "}
        {inputText
          ? <><Text>{inputText}</Text><Text color={theme.ACCENT}>{"_"}</Text></>
          : <Text color={theme.DIM}>{"type a decision and press Enter"}</Text>
        }
      </Text>
    </DashCard>
  );
}
