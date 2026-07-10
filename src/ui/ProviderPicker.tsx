import React, { useMemo, useState } from "react";
import { Box, Text, useFocus, useInput } from "ink";
import type { ProviderConfig, ProviderId, ProviderPickerAction } from "../core/providerLauncher/types.js";
import { traceInputDebug } from "../core/debug/inputDebug.js";
import { FOCUS_IDS } from "./focus.js";
import {
  clampVisualText,
  getShellWidth,
  type Layout,
  usePanelAvailableRows,
  getAvailableRowsForPanel,
  useAppLayoutBudget,
  useActivePanelLayout,
  type ActivePanelLayout,
  type PanelLayout,
  usePanelLayout,
} from "./layout.js";
import { calculateListWindow } from "./layoutListWindow.js";
import { useTheme } from "./theme.js";

// ─── Types & helpers ─────────────────────────────────────────────────────────

interface ProviderPickerProps {
  layout?: Layout;
  providers: readonly ProviderConfig[];
  onAction: (providerId: ProviderId, action: ProviderPickerAction) => void;
  onCancel: () => void;
  /** When set, the picker mounts directly at this provider's action panel. */
  initialProviderId?: ProviderId;
  availableRows?: number;
  activePanelLayout?: ActivePanelLayout;
  panelLayout?: PanelLayout;
}

interface ProviderActionItem {
  value: ProviderPickerAction;
  label: string;
  disabledReason?: string | null;
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, index));
}

export function getTableLayout(innerWidth: number, isMicro = false) {
  if (innerWidth < 70) {
    const columnWidthBudget = Math.max(26, innerWidth - 5 - 4);
    const status = Math.min(8, Math.max(6, columnWidthBudget - 20));
    const tool = innerWidth < 65 ? 0 : 4;
    const stream = innerWidth < 65 ? 0 : 4;
    const context = innerWidth < 45 ? 0 : Math.min(11, Math.max(10, columnWidthBudget - status - (tool || 4) - (stream || 4) - 16));
    const provider = Math.min(isMicro ? 10 : 14, Math.max(8, columnWidthBudget - status - tool - stream - context - 8));
    const model = Math.max(5, columnWidthBudget - provider - context - tool - stream - status);
    const trailingPadding = 0;
    return { provider, model, context, tool, stream, status, trailingPadding };
  }

  const provider = Math.min(22, Math.max(12, Math.floor(innerWidth * 0.18)));
  const status = Math.min(20, Math.max(12, Math.floor(innerWidth * 0.15)));
  const context = Math.min(14, Math.max(11, Math.floor(innerWidth * 0.12)));
  const tool = 4;
  const stream = 4;
  const fixed = 5 + provider + 1 + context + 1 + tool + 1 + stream + 1 + status;
  const model = Math.max(10, innerWidth - fixed - 3);
  const trailingPadding = Math.max(0, innerWidth - (fixed + 1 + model + 1));
  
  return {
    provider,
    model,
    context,
    tool,
    stream,
    status,
    trailingPadding
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProviderPicker({
  layout,
  providers,
  onAction,
  onCancel,
  initialProviderId,
  availableRows: propAvailableRows,
  activePanelLayout,
  panelLayout,
}: ProviderPickerProps) {
  const theme = useTheme();
  const budget = useAppLayoutBudget();
  const { isFocused } = useFocus({ id: FOCUS_IDS.providerPicker, autoFocus: true });
  const initialIndex = initialProviderId
    ? Math.max(0, providers.findIndex((p) => p.id === initialProviderId))
    : 0;
  const [providerIndex, setProviderIndex] = useState(initialIndex);
  const [mode, setMode] = useState<"providers" | "actions">(
    initialProviderId ? "actions" : "providers",
  );
  const [actionIndex, setActionIndex] = useState(0);

  const contextLayout = useActivePanelLayout();
  const activeLayout = (activePanelLayout ?? contextLayout) as ActivePanelLayout | undefined;

  const selectedProvider = providers[clampIndex(providerIndex, providers.length)];
  const shellWidth = getShellWidth(layout?.cols ?? 120);
  const panelWidth = activeLayout
    ? activeLayout.width
    : Math.max(
        42,
        Math.min((layout as any)?.contentWidth ?? (shellWidth - 2), shellWidth - 2)
      );

  const hookPanelLayout = usePanelLayout();
  const hookAvailableRows = usePanelAvailableRows();
  const resolvedPanelLayout = useMemo<PanelLayout>(() => {
    if (panelLayout) return panelLayout;
    if (hookPanelLayout) return hookPanelLayout;

    const mode = layout?.mode ?? "regular";
    const resolvedRows = activeLayout
      ? activeLayout.availableRows
      : getAvailableRowsForPanel(layout || { cols: 120, rows: 24, mode: "regular" }, propAvailableRows ?? hookAvailableRows);
    const resolvedCols = activeLayout
      ? activeLayout.availableCols
      : Math.max(30, shellWidth - 4);

    return {
      mode: (mode === "compact" || mode === "micro" as any) ? "compact" : mode === "expanded" || mode === "max" as any || mode === "wide" as any ? "expanded" : "regular",
      availableRows: resolvedRows,
      availableCols: resolvedCols,
    };
  }, [panelLayout, hookPanelLayout, layout, activeLayout, propAvailableRows, shellWidth, hookAvailableRows]);

  const availableRows = resolvedPanelLayout.availableRows;
  const innerWidth = resolvedPanelLayout.availableCols;

  const isCompactLayout = resolvedPanelLayout.mode === "compact";

  // Compact columns widths:
  const markerWidth = 5;
  const compactContextWidth = innerWidth >= 90 ? 6 : 5;
  const compactStatusWidth = innerWidth >= 90 ? 8 : 6;
  const compactProviderWidth = Math.max(11, Math.min(14, Math.floor(innerWidth * 0.15)));
  const spacingWidth = 4;
  const fixedWidth = markerWidth + compactProviderWidth + compactContextWidth + compactStatusWidth + spacingWidth;
  const compactModelWidth = Math.max(12, innerWidth - fixedWidth);
  const compactWidths = {
    markerWidth,
    providerWidth: compactProviderWidth,
    modelWidth: compactModelWidth,
    contextWidth: compactContextWidth,
    statusWidth: compactStatusWidth
  };

  // Regular columns:
  const cols = getTableLayout(innerWidth, false);
  const providerNameWidth = cols.provider;
  const modelWidth = cols.model;
  const contextWidth = cols.context;
  const toolsWidth = cols.tool;
  const streamWidth = cols.stream;
  const statusWidth = cols.status;

  const helpText = isCompactLayout
    ? "Enter select | U use | S default | Esc close"
    : "Enter = select, U = use, S = set default, Esc = cancel";

  const actions = useMemo<ProviderActionItem[]>(() => {
    const routeUnavailable = selectedProvider?.routeMode === "in-codexa";
    const disabledReason = routeUnavailable
      ? null
      : selectedProvider?.routeUnavailableReason ?? "In-Codexa routing is not configured yet.";

    return [
      { value: "use-in-codexa", label: "Use in Codexa", disabledReason },
      { value: "select-model", label: "Select model", disabledReason },
      { value: "refresh-models", label: selectedProvider?.id === "anthropic" ? "Refresh Claude capabilities" : selectedProvider?.id === "local" ? "Refresh LM Studio metadata" : "Refresh models", disabledReason },
      ...(selectedProvider?.id === "google" || selectedProvider?.id === "local"
        ? [{ value: "run-diagnostics" as const, label: selectedProvider.id === "local" ? "Run Local diagnostics" : "Run Gemini diagnostics" }]
        : []),
      { value: "launch", label: "Launch external CLI" },
      { value: "set-default", label: "Set as workspace default" },
      { value: "cancel", label: "Cancel" },
    ];
  }, [selectedProvider]);

  useInput((input, key) => {
    traceInputDebug("provider_picker_input", {
      handler: "ProviderPicker.useInput",
      input,
      return: Boolean(key.return),
      escape: Boolean(key.escape),
      upArrow: Boolean(key.upArrow),
      downArrow: Boolean(key.downArrow),
      mode,
      providerIndex,
      actionIndex,
    });

    if (key.ctrl && (input === "c" || input === "q")) {
      onCancel();
      return;
    }

    if (key.escape) {
      if (mode === "actions") {
        setMode("providers");
        setActionIndex(0);
        return;
      }
      onCancel();
      return;
    }

    if (mode === "providers") {
      if (key.upArrow || input === "k") {
        setProviderIndex((current) => clampIndex(current - 1, providers.length));
        return;
      }
      if (key.downArrow || input === "j") {
        setProviderIndex((current) => clampIndex(current + 1, providers.length));
        return;
      }
      if (input.toLowerCase() === "s" && selectedProvider) {
        onAction(selectedProvider.id, "set-default");
        return;
      }
      if (input.toLowerCase() === "u" && selectedProvider) {
        onAction(selectedProvider.id, "use-in-codexa");
        return;
      }
      if (key.return && selectedProvider) {
        setMode("actions");
        setActionIndex(0);
      }
      return;
    }

    if (key.upArrow || input === "k") {
      setActionIndex((current) => clampIndex(current - 1, actions.length));
      return;
    }
    if (key.downArrow || input === "j") {
      setActionIndex((current) => clampIndex(current + 1, actions.length));
      return;
    }
    if (key.return && selectedProvider) {
      const action = actions[actionIndex];
      if (action?.disabledReason) return;
      onAction(selectedProvider.id, action?.value ?? "cancel");
    }
  }, { isActive: isFocused });

  const activeRouteIndex = providers.findIndex((p) => p.isActiveRoute);
  
  // ─── Layout & Windowing ───────────────────────────────────────────────────

  const windowResult = useMemo(() => {
    if (mode !== "providers") return null;

    if (resolvedPanelLayout.mode === "compact") {
      const titleRows = 1;
      const hasActiveRoute = activeRouteIndex >= 0;

      let footerRows = providers.length > resolvedPanelLayout.availableRows - titleRows ? 1 : 0;
      let visibleRows = Math.max(1, resolvedPanelLayout.availableRows - titleRows - footerRows);

      let start = clampIndex(
        providerIndex - Math.floor(visibleRows / 2),
        providers.length
      );
      let adjustedStart = Math.max(0, Math.min(start, providers.length - visibleRows));
      let end = Math.min(providers.length, adjustedStart + visibleRows);

      let reserveCurrent = false;
      if (hasActiveRoute && visibleRows < providers.length) {
        const isOutside = activeRouteIndex < adjustedStart || activeRouteIndex >= end;
        if (isOutside) {
          reserveCurrent = true;
          footerRows = providers.length > resolvedPanelLayout.availableRows - titleRows - 1 ? 1 : 0;
          visibleRows = Math.max(1, resolvedPanelLayout.availableRows - titleRows - footerRows - 1);
          start = clampIndex(
            providerIndex - Math.floor(visibleRows / 2),
            providers.length
          );
          adjustedStart = Math.max(0, Math.min(start, providers.length - visibleRows));
          end = Math.min(providers.length, adjustedStart + visibleRows);
        }
      }

      return {
        start: adjustedStart,
        end,
        showAbove: adjustedStart > 0,
        showBelow: end < providers.length,
        showRange: providers.length > visibleRows,
        showHeaders: false,
        showBorder: true,
        showTitle: true,
        reserveCurrent,
        renderMode: "compact" as const,
        visibleCount: visibleRows,
      };
    }

    if (resolvedPanelLayout.mode === "expanded" && providers.length <= 6) {
      return {
        start: 0,
        end: providers.length,
        showAbove: false,
        showBelow: false,
        showRange: false,
        showHeaders: false,
        showBorder: true,
        showTitle: true,
        reserveCurrent: false,
        renderMode: "compact" as const,
        visibleCount: providers.length,
      };
    }

    // Determine chrome rows based on available space
    let showBorder = true;
    let showTitle = true;
    let showHeaders = true;

    if (availableRows < 7) {
      showBorder = false;
      showTitle = false;
      showHeaders = false;
    } else if (availableRows < 9) {
      showHeaders = false;
    }

    const baseChrome = (showBorder ? 2 : 0) + (showTitle ? 1 : 0) + (showHeaders ? 1 : 0);
    const hasActiveRoute = activeRouteIndex >= 0;

    let window = calculateListWindow({
      itemCount: providers.length,
      selectedIndex: providerIndex,
      availableRows,
      chromeRows: baseChrome,
      showRangeLine: true,
    });

    let reserveCurrent = false;
    if (hasActiveRoute && window.visibleCount < providers.length) {
      const isOutside = activeRouteIndex < window.start || activeRouteIndex >= window.end;
      if (isOutside) {
        reserveCurrent = true;
        window = calculateListWindow({
          itemCount: providers.length,
          selectedIndex: providerIndex,
          availableRows,
          chromeRows: baseChrome + 1,
          showRangeLine: true,
        });
      }
    }

    return {
      ...window,
      showBorder,
      showTitle,
      showHeaders,
      reserveCurrent,
      renderMode: window.visibleCount < providers.length ? ("windowed" as const) : ("full" as const),
    };
  }, [mode, providers.length, providerIndex, availableRows, resolvedPanelLayout, activeRouteIndex]);

  const visibleProviders = useMemo(() => {
    if (mode !== "providers") return [];
    if (!windowResult) return providers;
    return providers.slice(windowResult.start, windowResult.end);
  }, [mode, providers, windowResult]);

  const showCurrent = mode === "providers" && windowResult?.reserveCurrent && 
    activeRouteIndex >= 0 && (activeRouteIndex < windowResult.start || activeRouteIndex >= windowResult.end);

  const titleText = mode === "actions" && selectedProvider
    ? `Provider action: ${selectedProvider.displayName}`
    : (windowResult?.showRange)
      ? `Providers · Showing ${windowResult.start + 1}-${windowResult.end} of ${providers.length}`
      : "Providers";

  const body = useMemo(() => {
    if (mode === "actions" && selectedProvider) {
      const inCodexaAvailable = selectedProvider.routeMode === "in-codexa";
      const isConfigured = inCodexaAvailable && !selectedProvider.routeUnavailableReason;
      const inCodexaStatusText = !inCodexaAvailable ? "Unavailable" : isConfigured ? "Available" : "Needs configuration";
      const inCodexaStatusColor = !inCodexaAvailable ? theme.error : isConfigured ? theme.success : theme.warning;

      if (isCompactLayout) {
        const statusText = selectedProvider.routeUnavailableReason ?? "Ready";
        const metadataLine = `Status: ${statusText} · Backend: ${selectedProvider.backendType} · Codexa: ${inCodexaStatusText}`;
        return (
          <Box flexDirection="column">
            <Box marginBottom={1} flexDirection="row" paddingX={2} overflow="hidden">
              <Text color={theme.textDim} wrap="truncate">
                {clampVisualText(metadataLine, innerWidth - 4)}
              </Text>
            </Box>
            {actions.map((action, index) => (
              <ActionRow
                key={action.value}
                label={action.label}
                disabledReason={action.disabledReason}
                isHighlighted={index === actionIndex}
                width={innerWidth}
              />
            ))}
          </Box>
        );
      }

      return (
        <Box flexDirection="column">
          <Box marginBottom={1} flexDirection="column" paddingX={2}>
            <Text color={theme.textDim}>Status: <Text color={theme.text}>{selectedProvider.routeUnavailableReason ?? "Ready"}</Text></Text>
            <Text color={theme.textDim}>Backend: <Text color={theme.text}>{selectedProvider.backendType}</Text></Text>
            <Text color={theme.textDim}>Use in Codexa: <Text color={inCodexaStatusColor}>{inCodexaStatusText}</Text></Text>
          </Box>
          {actions.map((action, index) => (
            <ActionRow
              key={action.value}
              label={action.label}
              disabledReason={action.disabledReason}
              isHighlighted={index === actionIndex}
              width={innerWidth}
            />
          ))}
        </Box>
      );
    }

    if (isCompactLayout) {
      return visibleProviders.map((provider, index) => (
        <ProviderRowCompact
          key={provider.id}
          provider={provider}
          isHighlighted={(windowResult!.start + index) === providerIndex}
          widths={compactWidths}
        />
      ));
    }

    return visibleProviders.map((provider, index) => (
      <ProviderRow
        key={provider.id}
        provider={provider}
        isHighlighted={(windowResult!.start + index) === providerIndex}
        widths={{ providerNameWidth, modelWidth, contextWidth, toolsWidth, streamWidth, statusWidth }}
      />
    ));
  }, [actionIndex, actions, contextWidth, innerWidth, mode, modelWidth, providerIndex, providerNameWidth, visibleProviders, windowResult?.start, streamWidth, toolsWidth, statusWidth, theme, selectedProvider, isCompactLayout, compactWidths]);

  const showBorder = mode === "actions" ? (availableRows >= actions.length + 7) : (windowResult?.showBorder ?? true);

  return (
    <Box flexDirection="column" width={panelWidth} flexShrink={0}>
      <Box
        borderStyle={showBorder ? "round" : undefined}
        borderColor={theme.prompt}
        paddingX={showBorder ? 1 : 0}
        paddingY={0}
        width={panelWidth}
        flexDirection="column"
        flexShrink={0}
      >
        {(windowResult?.showTitle ?? true) && (
          <Box width="100%" overflow="hidden" flexShrink={0}>
            <Text color={theme.accent} bold>
              {clampVisualText(showBorder ? `${titleText}   ${helpText}` : titleText, innerWidth)}
            </Text>
          </Box>
        )}

        {!(windowResult?.showTitle ?? true) && windowResult?.showRange && (
          <Box width="100%" overflow="hidden" flexShrink={0}>
            <Text color={theme.accent}>
              Showing {windowResult.start + 1}-{windowResult.end} of {providers.length}
            </Text>
          </Box>
        )}

        {windowResult?.showAbove && (
          <Box height={1} overflow="hidden" flexShrink={0}>
            <Text color={theme.accent}>{isCompactLayout ? "↑ more" : `↑ ${windowResult.start} more`}</Text>
          </Box>
        )}

        {mode === "providers" && (windowResult?.showHeaders ?? true) && (
          <Box width="100%" overflow="hidden" flexShrink={0}>
            <Text color={theme.textDim}>
              {"     "}
              {clampVisualText("Provider", providerNameWidth)}
              {" "}
              {clampVisualText("Model", modelWidth)}
              {contextWidth > 0 && " " + clampVisualText("Context", contextWidth)}
              {toolsWidth > 0 && " " + clampVisualText("Tool", toolsWidth)}
              {streamWidth > 0 && " " + clampVisualText("Strm", streamWidth)}
              {" "}
              {clampVisualText("Status", statusWidth)}
            </Text>
          </Box>
        )}

        <Box flexDirection="column" marginTop={0} width="100%" flexShrink={0}>
          {body}
        </Box>

        {showCurrent && activeRouteIndex >= 0 && (
          <Box height={1} overflow="hidden" flexShrink={0} marginTop={0}>
            <Text color={theme.textDim}>
              Current: <Text color={theme.text}>{providers[activeRouteIndex].displayName} / {providers[activeRouteIndex].currentModel}</Text>
            </Text>
          </Box>
        )}

        {windowResult?.showBelow && (
          <Box height={1} overflow="hidden" flexShrink={0}>
            <Text color={theme.accent}>{isCompactLayout ? "↓ more" : `↓ ${providers.length - windowResult.end} more`}</Text>
          </Box>
        )}
      </Box>

      {process.env.CODEXA_DEBUG_LAYOUT === "1" && (
        <Box flexDirection="column" marginTop={1} flexShrink={0}>
          <Text color="red">
            DEBUG layout: rows={layout?.rows} cols={layout?.cols} mode={layout?.mode} headerRows={budget?.headerRows ?? 6} panelRows={availableRows} bottomChromeRows={budget?.bottomChromeBudget.totalRows ?? 4} composerRows={budget?.composerRows ?? 3} providerRows={visibleProviders.length} renderMode={windowResult?.renderMode}
          </Text>
        </Box>
      )}
    </Box>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function capabilityFlag(value: boolean | null | undefined): string {
  if (value === true) return "Y";
  if (value === false) return "N";
  return "?";
}

function formatCompactStatus(status: string | undefined): string {
  switch (status) {
    case "Active":
      return "Active";
    case "Enabled":
      return "Ready";
    case "Needs config":
      return "Config";
    case "Disabled":
      return "Off";
    case "Unknown":
    default:
      return "?";
  }
}

function formatCompactContext(value: string | number | undefined): string {
  if (value === undefined || value === null) return "?";
  const raw = String(value).trim();
  if (!raw || raw === "Unknown" || raw === "?") return "?";
  const numeric = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return raw;
  if (numeric >= 1_000_000) {
    return `${(numeric / 1_000_000).toFixed(1)}M`;
  }
  if (numeric >= 1_000) {
    return `${Math.round(numeric / 1_000)}K`;
  }
  return String(numeric);
}

function ProviderRowCompact({
  provider,
  isHighlighted,
  widths,
}: {
  provider: ProviderConfig;
  isHighlighted: boolean;
  widths: {
    markerWidth: number;
    providerWidth: number;
    modelWidth: number;
    contextWidth: number;
    statusWidth: number;
  };
}) {
  const theme = useTheme();
  const marker = isHighlighted ? ">" : " ";
  const defaultMark = provider.isDefault ? "*" : " ";
  const activeMark = provider.isActiveRoute ? "@" : " ";
  const statusText = provider.isActiveRoute ? "Active" : provider.statusLabel;

  const compactStatus = formatCompactStatus(statusText);
  const compactContext = formatCompactContext(provider.contextLengthLabel);

  const providerColor = isHighlighted ? theme.text : theme.textMuted;
  const modelColor = theme.textDim;
  const statusColor = provider.isActiveRoute
    ? theme.success
    : provider.enabled && !provider.routeUnavailableReason
      ? theme.success
      : theme.warning;

  return (
    <Box width="100%" overflow="hidden" flexDirection="row" flexShrink={0}>
      <Box width={widths.markerWidth} flexShrink={0}>
        <Text color={isHighlighted ? theme.accent : theme.textDim}>
          {marker} {defaultMark} {activeMark}
        </Text>
      </Box>
      <Box width={widths.providerWidth} flexShrink={0} overflow="hidden">
        <Text color={providerColor} bold={isHighlighted}>
          {clampVisualText(provider.displayName, widths.providerWidth)}
        </Text>
      </Box>
      <Text> </Text>
      <Box width={widths.modelWidth} flexShrink={0} overflow="hidden">
        <Text color={modelColor}>{clampVisualText(provider.currentModel, widths.modelWidth)}</Text>
      </Box>
      <Text> </Text>
      <Box width={widths.contextWidth} flexShrink={0} overflow="hidden">
        <Text color={theme.textDim}>{clampVisualText(compactContext, widths.contextWidth)}</Text>
      </Box>
      <Text> </Text>
      <Box width={widths.statusWidth} flexShrink={0} overflow="hidden">
        <Text color={statusColor}>{clampVisualText(compactStatus, widths.statusWidth)}</Text>
      </Box>
    </Box>
  );
}

function ProviderRow({
  provider,
  isHighlighted,
  widths,
}: {
  provider: ProviderConfig;
  isHighlighted: boolean;
  widths: {
    providerNameWidth: number;
    modelWidth: number;
    contextWidth: number;
    toolsWidth: number;
    streamWidth: number;
    statusWidth: number;
  };
}) {
  const theme = useTheme();
  const statusColor = provider.isActiveRoute
    ? theme.success
    : provider.enabled && !provider.routeUnavailableReason
      ? theme.success
      : theme.warning;
  const marker = isHighlighted ? ">" : " ";
  const defaultMark = provider.isDefault ? "*" : " ";
  const activeMark = provider.isActiveRoute ? "@" : " ";
  const statusText = provider.isActiveRoute ? "Active" : provider.statusLabel;

  return (
    <Box width="100%" overflow="hidden" flexDirection="row" flexShrink={0}>
      <Box width={5} flexShrink={0}>
        <Text color={isHighlighted ? theme.accent : theme.textDim}>{marker} {defaultMark} {activeMark}</Text>
      </Box>
      <Box width={widths.providerNameWidth} flexShrink={0} overflow="hidden">
        <Text color={isHighlighted ? theme.text : theme.textMuted} bold={isHighlighted}>
          {clampVisualText(provider.displayName, widths.providerNameWidth)}
        </Text>
      </Box>
      <Text> </Text>
      <Box width={widths.modelWidth} flexShrink={0} overflow="hidden">
        <Text color={theme.textMuted}>{clampVisualText(provider.currentModel, widths.modelWidth)}</Text>
      </Box>
      {widths.contextWidth > 0 && (
        <>
          <Text> </Text>
          <Box width={widths.contextWidth} flexShrink={0} overflow="hidden">
            <Text color={theme.textMuted}>{clampVisualText(provider.contextLengthLabel ?? "Unknown", widths.contextWidth)}</Text>
          </Box>
        </>
      )}
      {widths.toolsWidth > 0 && (
        <>
          <Text> </Text>
          <Box width={widths.toolsWidth} flexShrink={0} overflow="hidden">
            <Text color={theme.textMuted}>{clampVisualText(capabilityFlag(provider.capabilityProfile?.supportsToolCalls), widths.toolsWidth)}</Text>
          </Box>
        </>
      )}
      {widths.streamWidth > 0 && (
        <>
          <Text> </Text>
          <Box width={widths.streamWidth} flexShrink={0} overflow="hidden">
            <Text color={theme.textMuted}>{clampVisualText(capabilityFlag(provider.capabilityProfile?.supportsStreaming), widths.streamWidth)}</Text>
          </Box>
        </>
      )}
      <Text> </Text>
      <Box width={widths.statusWidth} flexShrink={0} overflow="hidden">
        <Text color={statusColor}>{clampVisualText(statusText, widths.statusWidth)}</Text>
      </Box>
    </Box>
  );
}

function ActionRow({
  label,
  disabledReason,
  isHighlighted,
  width,
}: {
  label: string;
  disabledReason?: string | null;
  isHighlighted: boolean;
  width: number;
}) {
  const theme = useTheme();
  const text = disabledReason ? `${label} unavailable` : label;
  return (
    <Box width="100%" overflow="hidden">
      <Box width={2} flexShrink={0}>
        <Text color={isHighlighted ? theme.accent : theme.textDim}>{isHighlighted ? ">" : " "}</Text>
      </Box>
      <Box width={Math.max(10, width - 2)} flexShrink={0} overflow="hidden">
        <Text color={disabledReason ? theme.textDim : isHighlighted ? theme.text : theme.textMuted} bold={isHighlighted && !disabledReason}>
          {clampVisualText(text, Math.max(10, width - 2))}
        </Text>
      </Box>
    </Box>
  );
}
