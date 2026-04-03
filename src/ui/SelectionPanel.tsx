import React from "react";
import { Box, Text, useFocus, useInput } from "ink";
import SelectInput from "ink-select-input";
import { useTheme } from "./theme.js";

interface SelectionPanelProps {
  focusId: string;
  title: string;
  subtitle: string;
  items: Array<{ label: string; value: string }>;
  limit?: number;
  onSelect: (value: string) => void;
  onHighlight?: (value: string) => void;
  onCancel: () => void;
}

export function SelectionPanel({
  focusId,
  title,
  subtitle,
  items,
  limit,
  onSelect,
  onHighlight,
  onCancel,
}: SelectionPanelProps) {
  const theme = useTheme();
  const { isFocused } = useFocus({ id: focusId, autoFocus: true });

  useInput((_, key) => {
    if (key.escape) onCancel();
  }, { isActive: isFocused });

  return (
    <Box flexDirection="column" width="100%" marginTop={1}>
      {/* Block 1: title + instructions */}
      <Box
        borderStyle="round"
        borderColor={theme.BORDER_SUBTLE}
        paddingX={2}
        paddingY={1}
        width="100%"
      >
        <Text color={theme.ACCENT} bold>{title}  </Text>
        <Text color={theme.MUTED}>{subtitle}</Text>
      </Box>

      {/* Block 2: selection list */}
      <Box
        borderStyle="round"
        borderColor={theme.BORDER_ACTIVE}
        paddingX={2}
        paddingY={1}
        marginTop={1}
        width="100%"
      >
        <SelectInput
          items={items}
          isFocused={isFocused}
          limit={limit}
          onSelect={(item) => onSelect(item.value)}
          onHighlight={(item) => onHighlight?.(item.value)}
        />
      </Box>
    </Box>
  );
}
