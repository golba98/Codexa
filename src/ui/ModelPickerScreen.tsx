import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useFocus, useInput } from "ink";
import {
  type CodexModelCapability,
  type ReasoningEffortCapability,
  normalizeReasoningForModelCapabilities,
} from "../core/codexModelCapabilities.js";
import { formatReasoningLabel } from "../config/settings.js";
import { traceInputDebug } from "../core/inputDebug.js";
import { FOCUS_IDS } from "./focus.js";
import { clampVisualText, getShellWidth, type Layout } from "./layout.js";
import { useTheme } from "./theme.js";

type ModelPickerCloseReason = "escape" | "empty-selection";

interface ModelPickerScreenProps {
  layout: Layout;
  models: readonly CodexModelCapability[];
  currentModel: string;
  currentReasoning: string;
  activeProviderLabel?: string;
  isLoading?: boolean;
  onSelect: (model: string, reasoning: string) => void;
  onCancel: (reason?: ModelPickerCloseReason) => void;
}

function getInitialCursor(models: readonly CodexModelCapability[], currentModel: string): number {
  const index = models.findIndex((model) => model.model === currentModel || model.id === currentModel);
  return Math.max(0, index);
}

function getModelName(model: CodexModelCapability): string {
  return model.label === model.model ? model.model : `${model.label} (${model.model})`;
}

function getReasoningLevels(model: CodexModelCapability | undefined): readonly ReasoningEffortCapability[] {
  return model?.supportedReasoningLevels ?? [];
}

function normalizeDraftReasoning(
  model: CodexModelCapability | undefined,
  reasoning: string,
): string {
  if (!model) return reasoning;
  return normalizeReasoningForModelCapabilities(
    model.model,
    reasoning,
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

function getReasoningIndex(levels: readonly ReasoningEffortCapability[], reasoning: string): number {
  return Math.max(0, levels.findIndex((level) => level.id === reasoning));
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

export function ModelPickerScreen({
  layout,
  models,
  currentModel,
  currentReasoning,
  activeProviderLabel = "OpenAI",
  isLoading = false,
  onSelect,
  onCancel,
}: ModelPickerScreenProps) {
  const theme = useTheme();
  const { isFocused } = useFocus({ id: FOCUS_IDS.modelPicker, autoFocus: true });
  const [draftSelectedModel, setDraftSelectedModel] = useState(() => getInitialCursor(models, currentModel));
  const [draftReasoning, setDraftReasoning] = useState(() =>
    normalizeDraftReasoning(models[getInitialCursor(models, currentModel)], currentReasoning)
  );

  const selectedModel = models[draftSelectedModel];
  const selectedReasoningLevels = getReasoningLevels(selectedModel);
  const reasoningUnavailable = selectedReasoningLevels.length === 0;

  useEffect(() => {
    traceInputDebug("model_picker_panel_mounted", {
      focusTarget: FOCUS_IDS.modelPicker,
      modelCount: models.length,
      isLoading,
    });
    return () => {
      traceInputDebug("model_picker_panel_unmounted", {
        focusTarget: FOCUS_IDS.modelPicker,
      });
    };
  }, []);

  useEffect(() => {
    if (models.length === 0) {
      setDraftSelectedModel(0);
      setDraftReasoning(currentReasoning);
      return;
    }

    setDraftSelectedModel((current) => {
      const nextCursor = Math.min(Math.max(0, current), models.length - 1);
      const nextModel = models[nextCursor];
      setDraftReasoning((reasoning) => normalizeDraftReasoning(nextModel, reasoning));
      return nextCursor;
    });
  }, [currentReasoning, models]);

  const moveModel = (direction: -1 | 1) => {
    setDraftSelectedModel((current) => {
      const next = Math.max(0, Math.min(models.length - 1, current + direction));
      const nextModel = models[next];
      setDraftReasoning((reasoning) => normalizeDraftReasoning(nextModel, reasoning));
      return next;
    });
  };

  const moveReasoning = (direction: -1 | 1) => {
    const levels = getReasoningLevels(models[draftSelectedModel]);
    if (levels.length <= 1) return;

    setDraftReasoning((current) => {
      const currentIndex = getReasoningIndex(levels, current);
      const nextIndex = Math.max(0, Math.min(levels.length - 1, currentIndex + direction));
      return levels[nextIndex]?.id ?? current;
    });
  };

  useInput(
    (input, key) => {
      traceInputDebug("model_picker_panel_input", {
        handler: "ModelPickerScreen.useInput",
        key: describeInputKey(input, key),
        isFocused,
        isLoading,
        modelCount: models.length,
        cursor: draftSelectedModel,
        draftReasoning,
      });

      if (key.ctrl && (input === "c" || input === "q")) {
        onCancel("escape");
        return;
      }

      if (key.escape) {
        onCancel("escape");
        return;
      }

      if (key.return) {
        const model = models[draftSelectedModel];
        if (!model) {
          onCancel("empty-selection");
          return;
        }
        onSelect(model.model, normalizeDraftReasoning(model, draftReasoning));
        return;
      }

      if (key.upArrow || input === "k") {
        moveModel(-1);
        return;
      }

      if (key.downArrow || input === "j") {
        moveModel(1);
        return;
      }

      if (key.leftArrow || input === "h") {
        moveReasoning(-1);
        return;
      }

      if (key.rightArrow || input === "l") {
        moveReasoning(1);
      }
    },
    { isActive: isFocused },
  );

  const shellWidth = getShellWidth(layout.cols);
  const panelWidth = Math.max(38, Math.min(shellWidth - 2, layout.mode === "full" ? 74 : 64));
  const innerWidth = Math.max(20, panelWidth - 4);
  const help = layout.mode === "micro"
    ? "↑↓ · ←→ · Enter · Esc"
    : "↑↓ model · ←→ reasoning · Enter select · Esc cancel";
  const title = clampVisualText(`Select model   ${help}`, innerWidth);
  const routeText = `Active route: ${activeProviderLabel}`;
  const reasoningText = reasoningUnavailable
    ? "Reasoning: unavailable"
    : `Reasoning: ${formatReasoningLabel(draftReasoning)}`;

  return (
    <Box flexDirection="column" width={panelWidth}>
      <Box
        borderStyle="round"
        borderColor={theme.PROMPT}
        paddingX={1}
        paddingY={0}
        width={panelWidth}
        flexDirection="column"
      >
        <Box width="100%" overflow="hidden">
          <Text color={theme.ACCENT} bold>{title}</Text>
        </Box>
        <Box width="100%" overflow="hidden">
          <Text color={theme.MUTED}>
            {clampVisualText(routeText, innerWidth)}
          </Text>
        </Box>
        <Box width="100%" overflow="hidden">
          <Text color={reasoningUnavailable ? theme.DIM : theme.MUTED}>
            {clampVisualText(reasoningText, innerWidth)}
          </Text>
        </Box>

        <Box flexDirection="column" marginTop={0} width="100%">
          {models.length === 0 ? (
            <Text color={theme.MUTED}>
              {isLoading ? "Discovering models from the Codex runtime..." : "No models available."}
            </Text>
          ) : (
            models.map((model, index) => (
              <ModelPickerRow
                key={model.id}
                model={model}
                width={innerWidth}
                currentModel={currentModel}
                isHighlighted={index === draftSelectedModel}
                selectedReasoning={index === draftSelectedModel ? draftReasoning : normalizeDraftReasoning(model, currentReasoning)}
              />
            ))
          )}
        </Box>
      </Box>
    </Box>
  );
}

function ModelPickerRow({
  model,
  width,
  currentModel,
  isHighlighted,
  selectedReasoning,
}: {
  model: CodexModelCapability;
  width: number;
  currentModel: string;
  isHighlighted: boolean;
  selectedReasoning: string;
}) {
  const theme = useTheme();
  const isCurrent = model.model === currentModel || model.id === currentModel;
  const levels = getReasoningLevels(model);
  const markerWidth = 2;
  const checkWidth = 2;
  const reasoningPill = levels.length > 0 ? `[${formatReasoningLabel(selectedReasoning)}]` : "";
  const pillWidth = isHighlighted && width >= 48 ? Math.min(reasoningPill.length, 14) : 0;
  const gapWidth = pillWidth > 0 ? 2 : 0;
  const nameWidth = Math.max(8, width - markerWidth - checkWidth - pillWidth - gapWidth);
  const name = clampVisualText(getModelName(model), nameWidth);
  const pillText = pillWidth > 0 ? clampVisualText(reasoningPill, pillWidth) : "";

  return (
    <Box width="100%" overflow="hidden">
      <Box width={markerWidth} flexShrink={0}>
        <Text color={isHighlighted ? theme.ACCENT : theme.DIM}>{isHighlighted ? ">" : " "}</Text>
      </Box>
      <Box width={nameWidth} flexShrink={0} overflow="hidden">
        <Text color={isHighlighted ? theme.TEXT : theme.MUTED} bold={isHighlighted}>
          {name}
        </Text>
      </Box>
      <Box width={checkWidth} flexShrink={0}>
        <Text color={theme.DIM}>{isCurrent ? "✓" : " "}</Text>
      </Box>
      {pillWidth > 0 && (
        <>
          <Box width={gapWidth} flexShrink={0}>
            <Text>  </Text>
          </Box>
          <Box width={pillWidth} flexShrink={0} overflow="hidden">
            <Text color={theme.ACCENT} bold>
              {pillText}
            </Text>
          </Box>
        </>
      )}
    </Box>
  );
}
