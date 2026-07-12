import { useEffect, useMemo, useState } from "react";
import { Box, Text, useFocus, useInput } from "ink";
import {
  type CodexModelCapability,
  type ReasoningEffortCapability,
  normalizeReasoningForModelCapabilities,
} from "../../core/models/codexModelCapabilities.js";
import { formatReasoningLabel } from "../../config/settings.js";
import { traceInputDebug } from "../../core/debug/inputDebug.js";
import { FOCUS_IDS } from "../input/focus.js";
import {
  clampVisualText,
  getShellWidth,
  getAvailableRowsForPanel,
  useAppLayoutBudget,
  usePanelAvailableRows,
  type Layout,
  useActivePanelLayout,
  type ActivePanelLayout,
  type PanelLayout,
  usePanelLayout,
} from "../layout.js";
import { calculateListWindow } from "../timeline/layoutListWindow.js";
import { useTheme } from "../theme.js";
import type { GeminiModelSelection } from "../../core/providerRuntime/types.js";

// ─── Types & helpers ─────────────────────────────────────────────────────────

type ModelPickerCloseReason = "escape" | "empty-selection";
type ModelRenderMode = "full" | "compact" | "windowed";

interface ModelPickerScreenProps {
  layout: Layout & {
    contentWidth?: number;
  };
  availableRows?: number;
  activePanelLayout?: ActivePanelLayout;
  panelLayout?: PanelLayout;
  models: readonly CodexModelCapability[];
  currentModel: string;
  currentReasoning: string;
  currentGeminiSelection?: GeminiModelSelection;
  activeProviderLabel?: string;
  isLoading?: boolean;
  emptyMessage?: string;
  routeTextOverride?: string;
  onSelect: (model: string, reasoning: string, geminiSelection?: GeminiModelSelection) => void;
  onCancel: (reason?: ModelPickerCloseReason) => void;
}

function getInitialCursor(models: readonly CodexModelCapability[], currentModel: string, currentGeminiSelection?: GeminiModelSelection): number {
  if (currentGeminiSelection?.kind === "auto") {
    const familyId = currentGeminiSelection.family === "gemini-3" ? "auto-gemini-3" : "auto-gemini-2.5";
    const index = models.findIndex((m) => m.id === familyId);
    if (index >= 0) return index;
  }
  const index = models.findIndex((model) => model.model === currentModel || model.id === currentModel);
  return Math.max(0, index);
}

function getModelName(model: CodexModelCapability): string {
  return model.label === model.model ? model.model : `${model.label} (${model.model})`;
}

function getReasoningLevels(model: CodexModelCapability | undefined): readonly ReasoningEffortCapability[] {
  return model?.supportedReasoningLevels ?? [];
}

function getModelSourceMarker(models: readonly CodexModelCapability[], activeProviderLabel: string): string | null {
  if (activeProviderLabel !== "Claude" || models.length === 0) return null;
  const raw = models[0]?.raw as { source?: string; discoveryKind?: string } | null | undefined;
  const source = raw?.source;
  const sourceLabel = source === "claude-code-package"
    ? "installed package metadata"
    : source === "claude-code-command"
      ? "Claude Code command"
      : source === "claude-code-cache"
        ? "Claude Code cache"
        : source === "claude-code-config" || source === "settings" || source === "config"
          ? "Claude settings"
          : "Claude Code";
  if (source === "claude-code-package" || source === "claude-code-command" || source === "claude-code-cache" || source === "claude-code-config" || source === "claude-code" || source === "discovered") {
    return raw?.discoveryKind === "aliases"
      ? `Claude Code aliases resolved from ${sourceLabel}`
      : `Claude Code models discovered from ${sourceLabel}`;
  }
  if (source === "settings" || source === "config") return "Claude Code models discovered from Claude settings";
  if (source === "fallback") return "Claude Code discovery failed; using fallback aliases";
  return null;
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

// ─── Component ────────────────────────────────────────────────────────────────

export function ModelPickerScreen({
  layout,
  availableRows: propAvailableRows,
  activePanelLayout,
  panelLayout,
  models: baseModels,
  currentModel,
  currentReasoning,
  currentGeminiSelection,
  activeProviderLabel = "OpenAI",
  isLoading = false,
  emptyMessage,
  routeTextOverride,
  onSelect,
  onCancel,
}: ModelPickerScreenProps) {
  const theme = useTheme();
  const isGoogle = activeProviderLabel === "Google";

  const models = useMemo(() => {
    if (!isGoogle) return baseModels;

    const autoModels: CodexModelCapability[] = [
      {
        id: "auto-gemini-3",
        model: "gemini-3-flash-preview",
        label: "Auto (Gemini 3)",
        description: "Best available verified Gemini 3 model.",
        available: true,
        hidden: false,
        isDefault: false,
        defaultReasoningLevel: "medium",
        supportedReasoningLevels: null,
        reasoningLevelCount: null,
        source: "fallback",
        raw: { kind: "auto", family: "gemini-3" },
      },
      {
        id: "auto-gemini-2.5",
        model: "gemini-2.5-pro",
        label: "Auto (Gemini 2.5)",
        description: "Best available Gemini 2.5 model.",
        available: true,
        hidden: false,
        isDefault: false,
        defaultReasoningLevel: "high",
        supportedReasoningLevels: null,
        reasoningLevelCount: null,
        source: "fallback",
        raw: { kind: "auto", family: "gemini-2.5" },
      },
    ];

    const manualModels = baseModels.map((m) => ({
      ...m,
      label: `Manual: ${m.label}`,
      raw: { kind: "manual", modelId: m.model },
    }));

    return [...autoModels, ...manualModels];
  }, [baseModels, isGoogle]);

  const { isFocused } = useFocus({ id: FOCUS_IDS.modelPicker, autoFocus: true });
  const [draftSelectedModel, setDraftSelectedModel] = useState(() => getInitialCursor(models, currentModel, currentGeminiSelection));
  const [draftReasoning, setDraftReasoning] = useState(() =>
    normalizeDraftReasoning(models[getInitialCursor(models, currentModel, currentGeminiSelection)], currentReasoning)
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
        const geminiSelection = isGoogle ? (model.raw as GeminiModelSelection) : undefined;
        onSelect(model.model, normalizeDraftReasoning(model, draftReasoning), geminiSelection);
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

  const contextLayout = useActivePanelLayout();
  const activeLayout = (activePanelLayout ?? contextLayout) as ActivePanelLayout | undefined;

  const shellWidth = getShellWidth(layout.cols);
  const hookPanelLayout = usePanelLayout();
  const hookAvailableRows = usePanelAvailableRows();
  const resolvedPanelLayout = useMemo<PanelLayout>(() => {
    if (panelLayout) return panelLayout;
    if (hookPanelLayout) return hookPanelLayout;

    const mode = layout.mode;
    const resolvedRows = activeLayout
      ? activeLayout.availableRows
      : getAvailableRowsForPanel(layout, propAvailableRows ?? hookAvailableRows);
    const resolvedCols = activeLayout
      ? activeLayout.availableCols
      : Math.max(20, shellWidth - 4);

    return {
      mode: (mode === "compact" || mode === "micro" as any) ? "compact" : mode === "expanded" || mode === "max" as any || mode === "wide" as any ? "expanded" : "regular",
      availableRows: resolvedRows,
      availableCols: resolvedCols,
    };
  }, [panelLayout, hookPanelLayout, layout, activeLayout, propAvailableRows, shellWidth, hookAvailableRows]);

  const panelWidth = activeLayout
    ? activeLayout.width
    : Math.max(38, Math.min((layout as any).contentWidth ?? shellWidth, shellWidth - 2));

  const availableRows = resolvedPanelLayout.availableRows;
  const innerWidth = resolvedPanelLayout.availableCols;
  const help = resolvedPanelLayout.mode === "compact"
    ? "↑↓ · ←→ · Enter · Esc"
    : "↑↓ model · ←→ reasoning · Enter select · Esc cancel";
  const aOrAn = /^[aeiou]/i.test(activeProviderLabel) ? "an" : "a";
  const routeText = routeTextOverride ?? `Choose ${aOrAn} ${activeProviderLabel} model to use inside Codexa.`;
  const reasoningText = reasoningUnavailable
    ? (models.length === 0 ? "Reasoning: current/default" : "Reasoning: unavailable")
    : `Reasoning: ${formatReasoningLabel(draftReasoning)}`;
  const sourceMarker = getModelSourceMarker(models, activeProviderLabel);

  const appLayoutBudget = useAppLayoutBudget();
  
  const activeModelIndex = models.findIndex((m) => m.model === currentModel || m.id === currentModel);
  const hasSourceMarker = !!sourceMarker;

  // ─── Layout & Windowing ───────────────────────────────────────────────────

  const windowResult = useMemo(() => {
    const allowFull = appLayoutBudget?.showPanelColumnHeaders ?? true;

    // Try fitting with full metadata
    const fullChrome = 5 + (hasSourceMarker ? 1 : 0);
    if (allowFull && models.length + fullChrome <= availableRows) {
      return {
        ...calculateListWindow({ itemCount: models.length, selectedIndex: draftSelectedModel, availableRows, chromeRows: fullChrome, showIndicators: false }),
        mode: "full" as const,
        showRouteText: true,
        showReasoningText: true,
        showSourceMarker: hasSourceMarker,
      };
    }

    // Try fitting without source marker
    if (allowFull && models.length + 5 <= availableRows) {
      return {
        ...calculateListWindow({ itemCount: models.length, selectedIndex: draftSelectedModel, availableRows, chromeRows: 5, showIndicators: false }),
        mode: "full" as const,
        showRouteText: true,
        showReasoningText: true,
        showSourceMarker: false,
      };
    }

    // Try compact with reasoning
    if (models.length + 4 <= availableRows) {
      return {
        ...calculateListWindow({ itemCount: models.length, selectedIndex: draftSelectedModel, availableRows, chromeRows: 4, showIndicators: false }),
        mode: "compact" as const,
        showRouteText: false,
        showReasoningText: true,
        showSourceMarker: false,
      };
    }

    // Try minimal compact
    if (models.length + 3 <= availableRows) {
      return {
        ...calculateListWindow({ itemCount: models.length, selectedIndex: draftSelectedModel, availableRows, chromeRows: 3, showIndicators: false }),
        mode: "compact" as const,
        showRouteText: false,
        showReasoningText: false,
        showSourceMarker: false,
      };
    }

    // Windowed mode
    const window = calculateListWindow({
      itemCount: models.length,
      selectedIndex: draftSelectedModel,
      availableRows,
      chromeRows: 3, // Title (1) + Border (2)
      showIndicators: true,
    });

    return {
      ...window,
      mode: "windowed" as const,
      showRouteText: false,
      showReasoningText: false,
      showSourceMarker: false,
    };
  }, [models.length, draftSelectedModel, availableRows, hasSourceMarker, appLayoutBudget?.showPanelColumnHeaders]);

  const visibleModels = useMemo(() => {
    return models.slice(windowResult.start, windowResult.end);
  }, [models, windowResult.start, windowResult.end]);

  const activeModel = models[activeModelIndex];
  const showCurrentLine = windowResult.mode === "windowed" && activeModelIndex >= 0 && (activeModelIndex < windowResult.start || activeModelIndex >= windowResult.end);
  const title = clampVisualText(
    windowResult.mode === "windowed"
      ? `Select model · Showing ${windowResult.start + 1}-${windowResult.end} of ${models.length}`
      : `Select model   ${help}`,
    innerWidth,
  );

  return (
    <Box flexDirection="column" width={panelWidth}>
      <Box
        borderStyle="round"
        borderColor={theme.prompt}
        paddingX={1}
        paddingY={0}
        width={panelWidth}
        flexDirection="column"
      >
        <Box width="100%" overflow="hidden">
          <Text color={theme.accent} bold>{title}</Text>
        </Box>
        {windowResult.showRouteText && (
          <Box width="100%" overflow="hidden">
            <Text color={theme.textMuted}>
              {clampVisualText(routeText, innerWidth)}
            </Text>
          </Box>
        )}
        {windowResult.showReasoningText && (
          <Box width="100%" overflow="hidden">
            <Text color={reasoningUnavailable ? theme.textDim : theme.textMuted}>
              {clampVisualText(reasoningText, innerWidth)}
            </Text>
          </Box>
        )}
        {windowResult.showSourceMarker && sourceMarker && (
          <Box width="100%" overflow="hidden">
            <Text color={theme.textDim}>
              {clampVisualText(sourceMarker, innerWidth)}
            </Text>
          </Box>
        )}

        {showCurrentLine && activeModel && (
          <Box height={1} overflow="hidden">
            <Text color={theme.textMuted} wrap="truncate">Current: <Text color={theme.text} bold>{getModelName(activeModel)}</Text></Text>
          </Box>
        )}

        {windowResult.showAbove && (
          <Box height={1} overflow="hidden">
            <Text color={theme.accent}>↑ {windowResult.start} more</Text>
          </Box>
        )}

        <Box
          flexDirection="column"
          marginTop={0}
          width="100%"
          height={models.length > 0 ? visibleModels.length : undefined}
          overflow={models.length > 0 ? "hidden" : undefined}
        >
          {models.length === 0 ? (
            <Text color={theme.textMuted}>
              {isLoading
                ? `Discovering models from ${activeProviderLabel === "OpenAI" ? "the Codex runtime" : activeProviderLabel}...`
                : (emptyMessage ?? "No models available.")}
            </Text>
          ) : (
            visibleModels.map((model, index) => {
              const actualIndex = windowResult.start + index;
              return (
                <ModelPickerRow
                  key={model.id}
                  model={model}
                  width={innerWidth}
                  currentModel={currentModel}
                  currentGeminiSelection={currentGeminiSelection}
                  isHighlighted={actualIndex === draftSelectedModel}
                  selectedReasoning={actualIndex === draftSelectedModel ? draftReasoning : normalizeDraftReasoning(model, currentReasoning)}
                />
              );
            })
          )}
        </Box>

        {windowResult.showBelow && (
          <Box height={1} overflow="hidden">
            <Text color={theme.accent}>↓ {windowResult.hiddenBelow} more</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function ModelPickerRow({
  model,
  width,
  currentModel,
  currentGeminiSelection,
  isHighlighted,
  selectedReasoning,
}: {
  model: CodexModelCapability;
  width: number;
  currentModel: string;
  currentGeminiSelection?: GeminiModelSelection;
  isHighlighted: boolean;
  selectedReasoning: string;
}) {
  const theme = useTheme();

  let isCurrent = false;
  if (currentGeminiSelection?.kind === "auto") {
    isCurrent = (model.raw as GeminiModelSelection)?.kind === "auto" && (model.raw as any).family === currentGeminiSelection.family;
  } else if (currentGeminiSelection?.kind === "manual") {
    isCurrent = (model.raw as GeminiModelSelection)?.kind === "manual" && (model.raw as any).modelId === currentGeminiSelection.modelId;
  } else {
    isCurrent = model.model === currentModel || model.id === currentModel;
  }

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
        <Text color={isHighlighted ? theme.accent : theme.textDim}>{isHighlighted ? ">" : " "}</Text>
      </Box>
      <Box width={nameWidth} flexShrink={0} overflow="hidden">
        <Text color={isHighlighted ? theme.text : theme.textMuted} bold={isHighlighted} wrap="truncate">
          {name}
        </Text>
      </Box>
      <Box width={checkWidth} flexShrink={0}>
        <Text color={theme.textDim}>{isCurrent ? "✓" : " "}</Text>
      </Box>
      {pillWidth > 0 && (
        <>
          <Box width={gapWidth} flexShrink={0}>
            <Text>  </Text>
          </Box>
          <Box width={pillWidth} flexShrink={0} overflow="hidden">
            <Text color={theme.accent} bold wrap="truncate">
              {pillText}
            </Text>
          </Box>
        </>
      )}
    </Box>
  );
}
