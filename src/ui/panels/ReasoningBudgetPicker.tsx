import { Box, Text, useFocus, useInput } from "ink";
import { useState } from "react";
import {
  isSupportedReasoning,
  reconcileReasoning,
  stepReasoningBudget,
} from "../../core/models/reasoningControl.js";
import type { ReasoningControl } from "../../core/providerRuntime/types.js";
import { FOCUS_IDS } from "../input/focus.js";

export function ReasoningBudgetPicker({
  control,
  value,
  onSelect,
  onCancel,
}: {
  control: Extract<ReasoningControl, { kind: "budget" }>;
  value: string;
  onSelect: (value: string) => void;
  onCancel: () => void;
}) {
  const { isFocused } = useFocus({ id: FOCUS_IDS.reasoningPicker, autoFocus: true });
  const [draft, setDraft] = useState(() => reconcileReasoning(control, value));
  const [entry, setEntry] = useState("");
  useInput(
    (input, key) => {
      if (key.escape) onCancel();
      else if (key.return) {
        const value = entry ? `budget:${entry}` : draft;
        if (isSupportedReasoning(control, value)) onSelect(value);
      } else if (key.backspace || key.delete) setEntry((value) => value.slice(0, -1));
      else if (/^\d+$/.test(input)) setEntry((value) => (value + input).slice(0, 8));
      else if (key.leftArrow || key.downArrow) {
        setEntry("");
        setDraft((value) => stepReasoningBudget(control, value, -1));
      } else if (key.rightArrow || key.upArrow) {
        setEntry("");
        setDraft((value) => stepReasoningBudget(control, value, 1));
      } else if (input.toLowerCase() === "a" && control.auto) {
        setEntry("");
        setDraft("auto");
      } else if (input.toLowerCase() === "d" && control.canDisable) {
        setEntry("");
        setDraft("budget:0");
      }
    },
    { isActive: isFocused },
  );
  return (
    <Box flexDirection="column" borderStyle="round">
      <Text bold>
        {isFocused ? "› " : ""}Thinking budget: {entry || draft.replace("budget:", "")}
      </Text>
      <Text>
        {control.min}–{control.max} tokens · type a budget or arrows adjust · Enter save · Esc
        cancel
        {control.auto ? " · A auto" : ""}
        {control.canDisable ? " · D off" : ""}
      </Text>
    </Box>
  );
}
