import React, { useState, useCallback, useMemo } from "react";
import { Box, Text, useFocus, useInput } from "ink";
import {
  AVAILABLE_MODELS,
  getAvailableReasoningForModel,
  isReasoningInteractive,
  formatReasoningLabel,
  getRecommendedReasoningForModel,
  type AvailableModel,
  type ReasoningLevel,
} from "../config/settings.js";
import { FOCUS_IDS } from "./focus.js";
import { useTheme } from "./theme.js";

// ── Bar glyphs ─────────────────────────────────────────────────────────────
// 4 identical discrete blocks. Far left represents lowest, far right highest.
const BAR_GLYPHS = ["■", "■", "■", "■"] as const;

function glyphForIndex(index: number): string {
  return BAR_GLYPHS[Math.min(index, BAR_GLYPHS.length - 1)];
}

// ── Types ──────────────────────────────────────────────────────────────────

interface ModelReasoningPickerProps {
  currentModel: AvailableModel;
  currentReasoning: ReasoningLevel;
  onSelect: (model: AvailableModel, reasoning: ReasoningLevel) => void;
  onCancel: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export function ModelReasoningPicker({
  currentModel,
  currentReasoning,
  onSelect,
  onCancel,
}: ModelReasoningPickerProps) {
  const theme = useTheme();
  const { isFocused } = useFocus({ id: FOCUS_IDS.modelPicker, autoFocus: true });

  const [cursor, setCursor] = useState(() =>
    Math.max(0, AVAILABLE_MODELS.indexOf(currentModel)),
  );

  const [pendingReasoning, setPendingReasoning] = useState<Record<string, ReasoningLevel>>(() => {
    const init: Record<string, ReasoningLevel> = {};
    for (const m of AVAILABLE_MODELS) {
      const available = getAvailableReasoningForModel(m);
      init[m] = available.includes(currentReasoning)
        ? currentReasoning
        : getRecommendedReasoningForModel(m);
    }
    return init;
  });

  const highlightedModel = AVAILABLE_MODELS[cursor] as AvailableModel;

  const moveReasoning = useCallback(
    (direction: -1 | 1) => {
      const model = AVAILABLE_MODELS[cursor] as AvailableModel;
      if (!isReasoningInteractive(model)) return;

      const available = getAvailableReasoningForModel(model);
      setPendingReasoning((prev) => {
        const currentIdx = available.indexOf(prev[model] as ReasoningLevel);
        const nextIdx = Math.max(0, Math.min(available.length - 1, currentIdx + direction));
        if (nextIdx === currentIdx) return prev;
        return { ...prev, [model]: available[nextIdx] };
      });
    },
    [cursor],
  );

  useInput(
    (input, key) => {
      if (key.escape) {
        onCancel();
        return;
      }
      if (key.return) {
        const model = AVAILABLE_MODELS[cursor] as AvailableModel;
        const reasoning = pendingReasoning[model] as ReasoningLevel;
        onSelect(model, reasoning);
        return;
      }
      if (key.upArrow) {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow) {
        setCursor((c) => Math.min(AVAILABLE_MODELS.length - 1, c + 1));
        return;
      }
      if (key.leftArrow) {
        moveReasoning(-1);
        return;
      }
      if (key.rightArrow) {
        moveReasoning(1);
        return;
      }
    },
    { isActive: isFocused },
  );

  const rows = useMemo(
    () =>
      AVAILABLE_MODELS.map((model) => {
        const available = getAvailableReasoningForModel(model);
        const interactive = isReasoningInteractive(model);
        return { model, available, interactive };
      }),
    [],
  );

  const subtitleParts: string[] = ["↑↓ model"];
  if (isReasoningInteractive(highlightedModel)) {
    subtitleParts.push("←→ reasoning");
  }
  subtitleParts.push("Enter select", "Esc cancel");
  const subtitle = subtitleParts.join("  ·  ");

  // Reasoning label for highlighted model
  const highlightedPending = pendingReasoning[highlightedModel] as ReasoningLevel;
  const reasoningHint = `Reasoning: ${formatReasoningLabel(highlightedPending)}`;

  return (
    <Box flexDirection="column" width="100%" marginTop={1}>
      <Box
        borderStyle="round"
        borderColor={theme.BORDER_SUBTLE}
        paddingX={2}
        paddingY={1}
        width="100%"
      >
        <Box flexDirection="column" width="100%">
          <Box>
            <Text color={theme.ACCENT} bold>Select model  </Text>
            <Text color={theme.MUTED}>{subtitle}</Text>
          </Box>
          <Box marginTop={0}>
            <Text color={theme.DIM}>{reasoningHint}</Text>
          </Box>
        </Box>
      </Box>

      <Box
        borderStyle="round"
        borderColor={theme.BORDER_ACTIVE}
        paddingX={2}
        paddingY={1}
        marginTop={1}
        width="100%"
        flexDirection="column"
      >
        {rows.map((row, idx) => {
          const isHighlighted = idx === cursor;
          const isCommitted = row.model === currentModel;
          const pending = pendingReasoning[row.model] as ReasoningLevel;

          return (
            <ModelRow
              key={row.model}
              model={row.model}
              availableLevels={row.available}
              interactive={row.interactive}
              isHighlighted={isHighlighted}
              isCommitted={isCommitted}
              selectedReasoning={pending}
              theme={theme}
            />
          );
        })}
      </Box>
    </Box>
  );
}

// ── Row sub-component ────────────────────────────────────────────────────

interface ModelRowProps {
  model: AvailableModel;
  availableLevels: readonly ReasoningLevel[];
  interactive: boolean;
  isHighlighted: boolean;
  isCommitted: boolean;
  selectedReasoning: ReasoningLevel;
  theme: ReturnType<typeof useTheme>;
}

function ModelRow({
  model,
  availableLevels,
  interactive,
  isHighlighted,
  isCommitted,
  selectedReasoning,
  theme,
}: ModelRowProps) {
  const cursorGlyph = isHighlighted ? "▸ " : "  ";
  const nameColor = isHighlighted ? theme.TEXT : theme.MUTED;
  const commitMark = isCommitted ? "  ✓" : "";
  
  const selectedIndex = availableLevels.indexOf(selectedReasoning);

  const bars = availableLevels.map((level, i) => {
    const glyph = glyphForIndex(i);
    // Radio-button logic: only the exact selected index is highlighted
    const isActive = i === selectedIndex;
    
    let color: string;
    if (!interactive) {
      color = theme.DIM;
    } else if (isActive) {
      color = isHighlighted ? theme.ACCENT : theme.TEXT;
    } else {
      color = theme.DIM;
    }

    return (
      <Text key={level} color={color} bold={isActive && isHighlighted && interactive}>
        {glyph}
      </Text>
    );
  });

  return (
    <Box flexDirection="row" width="100%">
      <Box width={3}>
        <Text color={isHighlighted ? theme.ACCENT : theme.DIM}>{cursorGlyph}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text color={nameColor} bold={isHighlighted}>
          {model}
        </Text>
        <Text color={theme.DIM}>{commitMark}</Text>
      </Box>
      <Box flexDirection="row" gap={1}>
        {isHighlighted && bars}
      </Box>
    </Box>
  );
}
