import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Box, Text, useFocus, useInput } from "ink";
import {
  type CodexModelCapability,
  type ReasoningEffortCapability,
  normalizeReasoningForModelCapabilities,
} from "../core/codexModelCapabilities.js";
import { formatReasoningLabel } from "../config/settings.js";
import { traceInputDebug } from "../core/inputDebug.js";
import { FOCUS_IDS } from "./focus.js";
import { useTheme } from "./theme.js";

type ModelPickerCloseReason = "escape" | "empty-selection";

interface ModelReasoningPickerProps {
  models: readonly CodexModelCapability[];
  currentModel: string;
  currentReasoning: string;
  isLoading?: boolean;
  onSelect: (model: string, reasoning: string) => void;
  onCancel: (reason?: ModelPickerCloseReason) => void;
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

function getInitialCursor(models: readonly CodexModelCapability[], currentModel: string): number {
  return Math.max(0, models.findIndex((model) => model.model === currentModel || model.id === currentModel));
}

function buildPendingReasoning(
  models: readonly CodexModelCapability[],
  currentReasoning: string,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const model of models) {
    next[model.model] = getInitialReasoning(model, currentReasoning);
  }
  return next;
}

function describeInputKey(
  input: string,
  key: {
    escape?: boolean;
    return?: boolean;
    upArrow?: boolean;
    downArrow?: boolean;
    leftArrow?: boolean;
    rightArrow?: boolean;
    ctrl?: boolean;
    meta?: boolean;
  },
) {
  return {
    input,
    escape: Boolean(key.escape),
    return: Boolean(key.return),
    upArrow: Boolean(key.upArrow),
    downArrow: Boolean(key.downArrow),
    leftArrow: Boolean(key.leftArrow),
    rightArrow: Boolean(key.rightArrow),
    ctrl: Boolean(key.ctrl),
    meta: Boolean(key.meta),
  };
}

export function ModelReasoningPicker({
  models,
  currentModel,
  currentReasoning,
  isLoading = false,
  onSelect,
  onCancel,
}: ModelReasoningPickerProps) {
  const theme = useTheme();
  const { isFocused } = useFocus({ id: FOCUS_IDS.modelPicker, autoFocus: true });
  const visibleModels = models;
  const initializedModelsRef = useRef(false);

  const [cursor, setCursor] = useState(() =>
    getInitialCursor(visibleModels, currentModel),
  );

  const [pendingReasoning, setPendingReasoning] = useState<Record<string, string>>(() =>
    buildPendingReasoning(visibleModels, currentReasoning)
  );

  useEffect(() => {
    traceInputDebug("model_picker_mounted", {
      focusTarget: FOCUS_IDS.modelPicker,
      modelCount: visibleModels.length,
      isLoading,
    });
    return () => {
      traceInputDebug("model_picker_unmounted", {
        focusTarget: FOCUS_IDS.modelPicker,
      });
    };
  }, []);

  useEffect(() => {
    traceInputDebug("model_picker_focus", {
      isFocused,
      focusTarget: FOCUS_IDS.modelPicker,
      modelCount: visibleModels.length,
      isLoading,
    });
  }, [isFocused, isLoading, visibleModels.length]);

  useEffect(() => {
    traceInputDebug("model_picker_models_state", {
      isLoading,
      modelCount: visibleModels.length,
      currentModel,
    });

    if (visibleModels.length === 0) {
      initializedModelsRef.current = false;
      setCursor(0);
      setPendingReasoning({});
      return;
    }

    setCursor((currentCursor) => {
      const maxCursor = Math.max(0, visibleModels.length - 1);
      if (!initializedModelsRef.current) {
        initializedModelsRef.current = true;
        return Math.min(getInitialCursor(visibleModels, currentModel), maxCursor);
      }
      return Math.min(Math.max(0, currentCursor), maxCursor);
    });

    setPendingReasoning((prev) => {
      const next: Record<string, string> = {};
      let changed = Object.keys(prev).length !== visibleModels.length;

      for (const model of visibleModels) {
        const value = prev[model.model] ?? getInitialReasoning(model, currentReasoning);
        next[model.model] = value;
        if (prev[model.model] !== value) {
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [currentModel, currentReasoning, isLoading, visibleModels]);

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
    (input, key) => {
      traceInputDebug("model_picker_input", {
        handler: "ModelReasoningPicker.useInput",
        key: describeInputKey(input, key),
        isFocused,
        isLoading,
        modelCount: visibleModels.length,
        cursor,
      });

      if (key.escape) {
        traceInputDebug("model_picker_close_request", {
          reason: "escape",
          handler: "ModelReasoningPicker.useInput",
          modelCount: visibleModels.length,
        });
        onCancel("escape");
        return;
      }
      if (key.return) {
        const model = visibleModels[cursor];
        if (!model) {
          traceInputDebug("model_picker_close_request", {
            reason: "empty-selection",
            handler: "ModelReasoningPicker.useInput",
            modelCount: visibleModels.length,
          });
          onCancel("empty-selection");
          return;
        }
        const reasoning = pendingReasoning[model.model] ?? getInitialReasoning(model, currentReasoning);
        traceInputDebug("model_selection_start", {
          handler: "ModelReasoningPicker.useInput",
          model: model.model,
          reasoning,
        });
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

  if (visibleModels.length === 0) {
    return <LoadingPickerView theme={theme} isLoading={isLoading} />;
  }

  return (
    <InteractivePickerView
      rows={rows}
      cursor={cursor}
      currentModel={currentModel}
      currentReasoning={currentReasoning}
      pendingReasoning={pendingReasoning}
      highlightedModel={highlightedModel}
      theme={theme}
    />
  );
}

function LoadingPickerView({
  theme,
  isLoading,
}: {
  theme: ReturnType<typeof useTheme>;
  isLoading: boolean;
}) {
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
            <Text color={theme.MUTED}>Esc cancel</Text>
          </Box>
          <Box marginTop={0}>
            <Text color={theme.DIM}>
              {isLoading
                ? "Discovering models from the Codex runtime…"
                : "No models available yet."}
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

interface InteractivePickerViewProps {
  rows: Array<{
    model: CodexModelCapability;
    available: readonly ReasoningEffortCapability[];
    interactive: boolean;
  }>;
  cursor: number;
  currentModel: string;
  currentReasoning: string;
  pendingReasoning: Record<string, string>;
  highlightedModel: CodexModelCapability | undefined;
  theme: ReturnType<typeof useTheme>;
}

function InteractivePickerView({
  rows,
  cursor,
  currentModel,
  currentReasoning,
  pendingReasoning,
  highlightedModel,
  theme,
}: InteractivePickerViewProps) {
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
