import React, { useState, useCallback, useMemo } from "react";
import { Box, Text, useFocus, useInput } from "ink";
import {
  type CodexModelCapability,
  type ReasoningEffortCapability,
  normalizeReasoningForModelCapabilities,
} from "../core/codexModelCapabilities.js";
import { formatReasoningLabel } from "../config/settings.js";
import { FOCUS_IDS } from "./focus.js";
import { useTheme } from "./theme.js";

interface ModelReasoningPickerProps {
  models: readonly CodexModelCapability[];
  currentModel: string;
  currentReasoning: string;
  onSelect: (model: string, reasoning: string) => void;
  onCancel: () => void;
}

function getModelReasoningLevels(model: CodexModelCapability): readonly ReasoningEffortCapability[] {
  return model.supportedReasoningLevels ?? [];
}

function getInitialReasoning(model: CodexModelCapability, currentReasoning: string): string {
  return normalizeReasoningForModelCapabilities(
    model.model,
    currentReasoning,
    {
      status: "ready",
      source: model.source,
      models: [model],
      discoveredAt: Date.now(),
      executable: null,
      error: null,
    },
  );
}

export function ModelReasoningPicker({
  models,
  currentModel,
  currentReasoning,
  onSelect,
  onCancel,
}: ModelReasoningPickerProps) {
  const theme = useTheme();
  const { isFocused } = useFocus({ id: FOCUS_IDS.modelPicker, autoFocus: true });
  const visibleModels = models.length > 0 ? models : [];

  const [cursor, setCursor] = useState(() =>
    Math.max(0, visibleModels.findIndex((model) => model.model === currentModel || model.id === currentModel)),
  );

  const [pendingReasoning, setPendingReasoning] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const model of visibleModels) {
      init[model.model] = getInitialReasoning(model, currentReasoning);
    }
    return init;
  });

  const highlightedModel = visibleModels[Math.min(cursor, Math.max(0, visibleModels.length - 1))];

  const moveReasoning = useCallback(
    (direction: -1 | 1) => {
      const model = visibleModels[cursor];
      if (!model) return;

      const available = getModelReasoningLevels(model);
      if (available.length <= 1) return;

      setPendingReasoning((prev) => {
        const currentValue = prev[model.model] ?? getInitialReasoning(model, currentReasoning);
        const currentIdx = Math.max(0, available.findIndex((level) => level.id === currentValue));
        const nextIdx = Math.max(0, Math.min(available.length - 1, currentIdx + direction));
        if (nextIdx === currentIdx) return prev;
        return { ...prev, [model.model]: available[nextIdx]!.id };
      });
    },
    [currentReasoning, cursor, visibleModels],
  );

  useInput(
    (_, key) => {
      if (key.escape) {
        onCancel();
        return;
      }
      if (key.return) {
        const model = visibleModels[cursor];
        if (!model) {
          onCancel();
          return;
        }
        const reasoning = pendingReasoning[model.model] ?? getInitialReasoning(model, currentReasoning);
        onSelect(model.model, reasoning);
        return;
      }
      if (key.upArrow) {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow) {
        setCursor((c) => Math.min(visibleModels.length - 1, c + 1));
        return;
      }
      if (key.leftArrow) {
        moveReasoning(-1);
        return;
      }
      if (key.rightArrow) {
        moveReasoning(1);
      }
    },
    { isActive: isFocused },
  );

  const rows = useMemo(
    () =>
      visibleModels.map((model) => {
        const available = getModelReasoningLevels(model);
        return {
          model,
          available,
          interactive: available.length > 1,
        };
      }),
    [visibleModels],
  );

  const subtitleParts: string[] = ["↑↓ model"];
  if (highlightedModel && getModelReasoningLevels(highlightedModel).length > 1) {
    subtitleParts.push("←→ reasoning");
  }
  subtitleParts.push("Enter select", "Esc cancel");
  const subtitle = subtitleParts.join("  ·  ");

  const highlightedPending = highlightedModel
    ? pendingReasoning[highlightedModel.model] ?? getInitialReasoning(highlightedModel, currentReasoning)
    : currentReasoning;
  const reasoningHint = highlightedModel?.supportedReasoningLevels
    ? `Reasoning: ${formatReasoningLabel(highlightedPending)}`
    : "Reasoning metadata unavailable";

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
          const isCommitted = row.model.model === currentModel || row.model.id === currentModel;
          const pending = pendingReasoning[row.model.model] ?? getInitialReasoning(row.model, currentReasoning);

          return (
            <ModelRow
              key={row.model.id}
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

interface ModelRowProps {
  model: CodexModelCapability;
  availableLevels: readonly ReasoningEffortCapability[];
  interactive: boolean;
  isHighlighted: boolean;
  isCommitted: boolean;
  selectedReasoning: string;
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
  const selectedIndex = availableLevels.findIndex((level) => level.id === selectedReasoning);
  const name = model.label === model.model ? model.model : `${model.label} (${model.model})`;

  const bars = availableLevels.map((level, i) => {
    const isActive = i === selectedIndex;
    const color = !interactive
      ? theme.DIM
      : isActive
        ? isHighlighted ? theme.ACCENT : theme.TEXT
        : theme.DIM;

    return (
      <Text key={level.id} color={color} bold={isActive && isHighlighted && interactive}>
        ■
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
          {name}
        </Text>
        <Text color={theme.DIM}>{commitMark}</Text>
      </Box>
      <Box flexDirection="row" gap={1}>
        {isHighlighted && bars}
      </Box>
    </Box>
  );
}
