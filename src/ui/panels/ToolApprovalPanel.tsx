import React, { useState } from "react";
import { Box, Text, useFocus, useInput } from "ink";
import type { ToolApprovalDecision, ToolApprovalRequest } from "../../core/providers/types.js";
import { useTheme } from "../theme.js";

const OPTIONS: Array<{ label: string; value: ToolApprovalDecision }> = [
  { label: "Allow once", value: "allow-once" },
  { label: "Allow matching action for this run", value: "allow-for-run" },
  { label: "Deny", value: "deny" },
];

export function ToolApprovalPanel({ focusId, request, onSelect, onCancelRun }: {
  focusId: string;
  request: ToolApprovalRequest;
  onSelect: (decision: ToolApprovalDecision) => void;
  onCancelRun?: () => void;
}) {
  const theme = useTheme();
  const { isFocused } = useFocus({ id: focusId, autoFocus: true });
  const [selected, setSelected] = useState(0);
  useInput((input, key) => {
    if (key.ctrl && input === "c") return onCancelRun?.();
    if (key.escape) return onSelect("deny");
    if (key.upArrow || input === "k") return setSelected((value) => Math.max(0, value - 1));
    if (key.downArrow || key.tab || input === "j") return setSelected((value) => Math.min(OPTIONS.length - 1, value + 1));
    if (key.return) onSelect(OPTIONS[selected]!.value);
  }, { isActive: isFocused });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.warning} paddingX={2} paddingY={1} width="100%">
      <Text color={theme.warning} bold>LOCAL MODEL PERMISSION</Text>
      <Text color={theme.text}>The local model wants to run {request.tool}.</Text>
      {request.command && <Text color={theme.textMuted}>Command: {request.command}</Text>}
      {request.paths.map((path) => <Text key={path} color={theme.textMuted}>Path: {path}</Text>)}
      {request.tool === "run_shell" && <Text color={theme.warning}>Shell commands can affect files, processes, and the network.</Text>}
      <Box flexDirection="column" marginTop={1}>
        {OPTIONS.map((option, index) => (
          <Text key={option.value} color={index === selected ? theme.accent : theme.textMuted} bold={index === selected}>
            {index === selected ? "› " : "  "}{option.label}
          </Text>
        ))}
      </Box>
      <Text color={theme.textDim}>↑/↓ or j/k to navigate · Enter to select · Esc to deny</Text>
    </Box>
  );
}
