import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useFocus, useInput } from "ink";
import { clampVisualText, usePanelLayout } from "../layout.js";
import { useTheme } from "../theme.js";
import { calculateResponsivePickerViewport } from "./responsivePickerViewport.js";

interface SelectionPanelProps {
  focusId: string;
  title: string;
  subtitle: string;
  items: Array<{ label: string; value: string }>;
  limit?: number;
  initialValue?: string;
  onSelect: (value: string) => void;
  onHighlight?: (value: string) => void;
  onCancel: () => void;
}

function clampIndex(index: number, count: number): number {
  return count <= 0 ? 0 : Math.max(0, Math.min(count - 1, index));
}

export function SelectionPanel({
  focusId,
  title,
  subtitle,
  items,
  initialValue,
  onSelect,
  onHighlight,
  onCancel,
}: SelectionPanelProps) {
  const theme = useTheme();
  const panelLayout = usePanelLayout();
  const { isFocused } = useFocus({ id: focusId, autoFocus: true });
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const initialIndex = initialValue ? items.findIndex((item) => item.value === initialValue) : -1;
    return initialIndex >= 0 ? initialIndex : 0;
  });
  const [scrollOffset, setScrollOffset] = useState(0);
  const availableRows = Math.max(1, panelLayout?.availableRows ?? 12);
  const innerWidth = Math.max(1, (panelLayout?.availableCols ?? 80) - 2);

  const viewport = useMemo(() => calculateResponsivePickerViewport({
    itemCount: items.length,
    selectedIndex,
    availableRows,
    chromeRows: availableRows >= 3 ? 2 : 0,
    scrollOffset,
  }), [availableRows, items.length, scrollOffset, selectedIndex]);

  useEffect(() => {
    setSelectedIndex((current) => clampIndex(current, items.length));
  }, [items.length]);

  useEffect(() => {
    setScrollOffset(viewport.start);
  }, [viewport.start]);

  const highlightIndex = (index: number) => {
    const nextIndex = clampIndex(index, items.length);
    setSelectedIndex(nextIndex);
    const item = items[nextIndex];
    if (item) onHighlight?.(item.value);
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      const item = items[viewport.selectedIndex];
      if (item) onSelect(item.value);
      return;
    }
    if (key.home) {
      highlightIndex(0);
      return;
    }
    if (key.end) {
      highlightIndex(items.length - 1);
      return;
    }
    if (key.pageUp) {
      highlightIndex(selectedIndex - Math.max(1, viewport.capacity));
      return;
    }
    if (key.pageDown) {
      highlightIndex(selectedIndex + Math.max(1, viewport.capacity));
      return;
    }
    if (key.upArrow || input === "k") {
      highlightIndex(selectedIndex - 1);
      return;
    }
    if (key.downArrow || input === "j") {
      highlightIndex(selectedIndex + 1);
    }
  }, { isActive: isFocused });

  const visibleItems = items.slice(viewport.start, viewport.end);
  const titleText = viewport.hasOverflow
    ? `${title} · ${viewport.selectedIndex + 1}/${items.length}`
    : title;
  const heading = innerWidth >= 70 ? `${titleText}  ${subtitle}` : titleText;

  return (
    <Box
      borderStyle={availableRows >= 3 ? "round" : undefined}
      borderColor={theme.borderFocused}
      paddingX={availableRows >= 3 ? 1 : 0}
      width="100%"
      flexDirection="column"
      overflow="hidden"
    >
      {availableRows >= 3 && (
        <Text color={theme.accent} bold wrap="truncate">
          {clampVisualText(heading, innerWidth)}
        </Text>
      )}
      {visibleItems.map((item, index) => {
        const actualIndex = viewport.start + index;
        const selected = actualIndex === viewport.selectedIndex;
        return (
          <Box key={item.value} width="100%" overflow="hidden">
            <Text color={selected ? theme.accent : theme.textMuted} bold={selected} wrap="truncate">
              {selected ? "> " : "  "}{clampVisualText(item.label, Math.max(1, innerWidth - 2))}
            </Text>
          </Box>
        );
      })}
      {availableRows >= 3 && (
        <Text color={theme.textDim}>↑↓ move · Enter confirm · Esc close</Text>
      )}
    </Box>
  );
}
