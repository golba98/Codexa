import React, { useMemo, useState } from "react";
import { Box, Text, useFocus, useInput } from "ink";
import type { ProviderConfig, ProviderId, ProviderPickerAction } from "../core/providerLauncher/types.js";
import { traceInputDebug } from "../core/debug/inputDebug.js";
import { FOCUS_IDS } from "./focus.js";
import { clampVisualText, getShellWidth, getVisualWidth, type TerminalViewport } from "./layout.js";
import { useTheme, type Theme } from "./theme.js";
import fs from "fs";
import path from "path";

// ─── Types & helpers ─────────────────────────────────────────────────────────

interface ProviderPickerProps {
  layout: TerminalViewport;
  providers: readonly ProviderConfig[];
  onAction: (providerId: ProviderId, action: ProviderPickerAction) => void;
  onCancel: () => void;
  /** When set, the picker mounts directly at this provider's action panel. */
  initialProviderId?: ProviderId;
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

function capabilityFlag(value: boolean | null | undefined): string {
  if (value === true) return "Y";
  if (value === false) return "N";
  return "?";
}

export interface TableColumns {
  markerSelected: number;
  markerDefault: number;
  markerCurrent: number;
  provider: number;
  model: number;
  context: number;
  tool: number;
  stream: number;
  status: number;
  showContext: boolean;
  showTool: boolean;
  showStream: boolean;
}

export function getTableLayout(innerWidth: number): TableColumns {
  const markerSelected = 1;
  const markerDefault = 1;
  const markerCurrent = 1;

  let showStream = false;
  let showTool = false;
  let showContext = false;

  // Priority logic for optional columns
  if (innerWidth >= 63) {
    showStream = true;
    showTool = true;
    showContext = true;
  } else if (innerWidth >= 58) {
    showTool = true;
    showContext = true;
  } else if (innerWidth >= 53) {
    showContext = true;
  }

  const streamWidth = showStream ? 4 : 0;
  const toolWidth = showTool ? 4 : 0;
  const contextWidth = showContext ? 12 : 0;
  const statusWidthDefault = 8;
  const providerWidthDefault = 14;

  const markerGaps = 2; // gaps between markers
  const dataGaps = 3 + (showContext ? 1 : 0) + (showTool ? 1 : 0) + (showStream ? 1 : 0);
  const totalGaps = markerGaps + dataGaps;

  const fixedWidthWithoutModel = 3 + totalGaps + providerWidthDefault + contextWidth + toolWidth + streamWidth + statusWidthDefault;

  let provider = providerWidthDefault;
  let status = statusWidthDefault;
  let model = 10;

  if (innerWidth >= fixedWidthWithoutModel + 10) {
    model = innerWidth - fixedWidthWithoutModel;
  } else {
    // Narrow terminal distribution logic
    const available = innerWidth - 8; // 3 markers + 5 gaps (no optional columns)
    if (available >= 20) {
      status = 8;
      const remaining = available - status;
      provider = Math.max(8, Math.min(14, Math.floor(remaining * 0.45)));
      model = remaining - provider;
    } else {
      status = Math.max(6, Math.floor(available * 0.25));
      provider = Math.max(8, Math.floor(available * 0.35));
      model = Math.max(6, available - status - provider);
    }
  }

  return {
    markerSelected,
    markerDefault,
    markerCurrent,
    provider,
    model,
    context: contextWidth,
    tool: toolWidth,
    stream: streamWidth,
    status,
    showContext,
    showTool,
    showStream,
  };
}

export function padVisualText(text: string, width: number): string {
  const clamped = clampVisualText(text, width);
  const visualLen = getVisualWidth(clamped);
  const diff = width - visualLen;
  if (diff > 0) {
    return clamped + " ".repeat(diff);
  }
  return clamped;
}

export function centerVisualText(text: string, width: number): string {
  const clamped = clampVisualText(text, width);
  const visualLen = getVisualWidth(clamped);
  const diff = width - visualLen;
  if (diff > 0) {
    const leftPad = Math.floor(diff / 2);
    const rightPad = diff - leftPad;
    return " ".repeat(leftPad) + clamped + " ".repeat(rightPad);
  }
  return clamped;
}

function logDebug(message: string) {
  if (process.env.CODEXA_TABLE_DEBUG === "1") {
    try {
      const logPath = path.join(process.cwd(), "codexa_table_debug.log");
      fs.appendFileSync(logPath, message + "\n", "utf8");
    } catch (e) {
      // ignore log errors
    }
  }
}

function wrapInBorders(content: React.ReactNode, innerWidth: number, themeBorderColor: string, key?: string | number) {
  return (
    <Box key={key} flexDirection="row" width={innerWidth + 4} height={1} overflow="hidden">
      <Text color={themeBorderColor}>│</Text>
      <Box width={innerWidth + 2} paddingX={1} flexShrink={0} overflow="hidden" height={1}>
        {content}
      </Box>
      <Text color={themeBorderColor}>│</Text>
    </Box>
  );
}

function renderProviderRow(
  provider: ProviderConfig,
  isHighlighted: boolean,
  cols: TableColumns,
  theme: Theme,
  innerWidth: number
) {
  const statusColor = provider.isActiveRoute
    ? theme.success
    : provider.enabled && !provider.routeUnavailableReason
      ? theme.success
      : theme.warning;
  const marker = isHighlighted ? ">" : " ";
  const defaultMark = provider.isDefault ? "*" : " ";
  const currentMark = provider.isActiveRoute ? "@" : " ";
  const statusText = provider.isActiveRoute ? "Active" : provider.statusLabel;

  const row = (
    <Box flexDirection="row" width={innerWidth}>
      <Text color={isHighlighted ? theme.accent : theme.textDim}>{padVisualText(marker, cols.markerSelected)}</Text>
      <Text> </Text>
      <Text color={theme.textDim}>{padVisualText(defaultMark, cols.markerDefault)}</Text>
      <Text> </Text>
      <Text color={theme.textDim}>{padVisualText(currentMark, cols.markerCurrent)}</Text>
      <Text> </Text>
      <Text color={isHighlighted ? theme.text : theme.textMuted} bold={isHighlighted}>
        {padVisualText(provider.displayName, cols.provider)}
      </Text>
      <Text> </Text>
      <Text color={theme.textMuted}>{padVisualText(provider.currentModel, cols.model)}</Text>
      {cols.showContext && (
        <Box flexDirection="row">
          <Text> </Text>
          <Text color={theme.textMuted}>{padVisualText(provider.contextLengthLabel ?? "Unknown", cols.context)}</Text>
        </Box>
      )}
      {cols.showTool && (
        <Box flexDirection="row">
          <Text> </Text>
          <Text color={theme.textMuted}>{padVisualText(capabilityFlag(provider.capabilityProfile?.supportsToolCalls), cols.tool)}</Text>
        </Box>
      )}
      {cols.showStream && (
        <Box flexDirection="row">
          <Text> </Text>
          <Text color={theme.textMuted}>{padVisualText(capabilityFlag(provider.capabilityProfile?.supportsStreaming), cols.stream)}</Text>
        </Box>
      )}
      <Text> </Text>
      <Text color={statusColor}>{padVisualText(statusText, cols.status)}</Text>
    </Box>
  );

  return wrapInBorders(row, innerWidth, theme.prompt, `provider-${provider.id}`);
}

function renderActionRow(
  label: string,
  disabledReason: string | null | undefined,
  isHighlighted: boolean,
  innerWidth: number,
  theme: Theme
) {
  const text = disabledReason ? `${label} unavailable` : label;
  const marker = isHighlighted ? ">" : " ";

  return wrapInBorders(
    <Box flexDirection="row" width={innerWidth}>
      <Text color={isHighlighted ? theme.accent : theme.textDim}>{padVisualText(marker, 2)}</Text>
      <Text color={disabledReason ? theme.textDim : isHighlighted ? theme.text : theme.textMuted} bold={isHighlighted && !disabledReason}>
        {padVisualText(text, innerWidth - 2)}
      </Text>
    </Box>,
    innerWidth,
    theme.prompt,
    `action-${label}`
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProviderPicker({ layout, providers, onAction, onCancel, initialProviderId }: ProviderPickerProps) {
  const theme = useTheme();
  const { isFocused } = useFocus({ id: FOCUS_IDS.providerPicker, autoFocus: true });
  const initialIndex = initialProviderId
    ? Math.max(0, providers.findIndex((p) => p.id === initialProviderId))
    : 0;
  const [providerIndex, setProviderIndex] = useState(initialIndex);
  const [mode, setMode] = useState<"providers" | "actions">(
    initialProviderId ? "actions" : "providers",
  );
  const [actionIndex, setActionIndex] = useState(0);

  const selectedProvider = providers[clampIndex(providerIndex, providers.length)];

  // Cap the table width in large terminals
  const maxTableWidth = 100;
  const panelWidth = Math.min(layout.contentWidth, getShellWidth(layout.cols) - 2, maxTableWidth);
  const innerWidth = Math.max(30, panelWidth - 4);

  const cols = useMemo(() => getTableLayout(innerWidth), [innerWidth]);

  // Debug logging
  if (process.env.CODEXA_TABLE_DEBUG === "1") {
    logDebug(
      `[DEBUG ${new Date().toISOString()}] Terminal Cols: ${layout.cols} | Panel Width: ${panelWidth} | Inner Width: ${innerWidth} | Columns: ${JSON.stringify(cols)}`
    );
  }

  const helpText = layout.mode === "micro"
    ? "Enter select  U use  S default  Esc"
    : "Enter = select, U = use, S = set default, Esc = cancel";
  const title = mode === "actions" && selectedProvider
    ? `Provider action: ${selectedProvider.displayName}`
    : "Providers";
  const actions = useMemo<ProviderActionItem[]>(() => {
    const routeUnavailable = selectedProvider?.routeMode === "in-codexa"
      ? null
      : selectedProvider?.routeUnavailableReason ?? "In-Codexa routing is not configured yet.";

    return [
      { value: "use-in-codexa", label: "Use in Codexa", disabledReason: routeUnavailable },
      { value: "select-model", label: "Select model", disabledReason: routeUnavailable },
      { value: "refresh-models", label: selectedProvider?.id === "anthropic" ? "Refresh Claude capabilities" : selectedProvider?.id === "local" ? "Refresh LM Studio metadata" : "Refresh models", disabledReason: routeUnavailable },
      ...(selectedProvider?.id === "google" || selectedProvider?.id === "local"
        ? [{ value: "run-diagnostics" as const, label: selectedProvider.id === "local" ? "Run Local diagnostics" : "Run Gemini diagnostics" }]
        : []),
      { value: "launch", label: "Launch external CLI" },
      { value: "set-default", label: "Set as workspace default" },
      { value: "cancel", label: "Cancel" },
    ];
  }, [selectedProvider]);

  // Scroll / pagination logic
  const maxBodyHeight = Math.max(3, layout.rows - 11);
  let startIdx = 0;
  let endIdx = providers.length;
  let showScrollIndicator = false;

  if (mode === "providers" && providers.length > maxBodyHeight) {
    showScrollIndicator = true;
    const visibleListHeight = maxBodyHeight - 1;
    const half = Math.floor(visibleListHeight / 2);
    startIdx = providerIndex - half;
    if (startIdx < 0) {
      startIdx = 0;
    }
    if (startIdx + visibleListHeight > providers.length) {
      startIdx = providers.length - visibleListHeight;
    }
    endIdx = startIdx + visibleListHeight;
  }

  const visibleProviders = providers.slice(startIdx, endIdx);

  // Actions scroll / pagination logic
  const maxActionBodyHeight = Math.max(3, layout.rows - 14);
  let actionStartIdx = 0;
  let actionEndIdx = actions.length;
  let showActionScrollIndicator = false;

  if (mode === "actions" && actions.length > maxActionBodyHeight) {
    showActionScrollIndicator = true;
    const visibleListHeight = maxActionBodyHeight - 1;
    const half = Math.floor(visibleListHeight / 2);
    actionStartIdx = actionIndex - half;
    if (actionStartIdx < 0) {
      actionStartIdx = 0;
    }
    if (actionStartIdx + visibleListHeight > actions.length) {
      actionStartIdx = actions.length - visibleListHeight;
    }
    actionEndIdx = actionStartIdx + visibleListHeight;
  }

  const visibleActions = actions.slice(actionStartIdx, actionEndIdx);

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
      onAction(selectedProvider.id, actions[actionIndex]?.value ?? "cancel");
    }
  }, { isActive: isFocused });

  // Compile the full frame representation first
  const lines: React.ReactNode[] = [];

  // Top border row
  lines.push(
    <Box key="top" flexDirection="row" width={panelWidth} height={1} overflow="hidden">
      <Text color={theme.prompt}>┌{"─".repeat(panelWidth - 2)}┐</Text>
    </Box>
  );

  // Title / help row
  const titleText = padVisualText(`${title}   ${helpText}`, innerWidth);
  lines.push(
    wrapInBorders(
      <Text color={theme.accent} bold>
        {titleText}
      </Text>,
      innerWidth,
      theme.prompt,
      "title"
    )
  );

  if (mode === "providers") {
    // Header row
    lines.push(
      wrapInBorders(
        <Text color={theme.textDim}>
          {padVisualText("", cols.markerSelected)}
          {" "}
          {padVisualText("", cols.markerDefault)}
          {" "}
          {padVisualText("", cols.markerCurrent)}
          {" "}
          {padVisualText("Provider", cols.provider)}
          {" "}
          {padVisualText("Model", cols.model)}
          {cols.showContext && (
            <>
              {" "}
              {padVisualText("Context", cols.context)}
            </>
          )}
          {cols.showTool && (
            <>
              {" "}
              {padVisualText("Tool", cols.tool)}
            </>
          )}
          {cols.showStream && (
            <>
              {" "}
              {padVisualText("Strm", cols.stream)}
            </>
          )}
          {" "}
          {padVisualText("Status", cols.status)}
        </Text>,
        innerWidth,
        theme.prompt,
        "header"
      )
    );

    // Provider data rows
    visibleProviders.forEach((provider, idx) => {
      const realIdx = startIdx + idx;
      if (process.env.CODEXA_TABLE_DEBUG === "1") {
        logDebug(`  Row: ${provider.id} | model: ${provider.currentModel} | expected_len: ${innerWidth}`);
      }
      lines.push(
        renderProviderRow(
          provider,
          realIdx === providerIndex,
          cols,
          theme,
          innerWidth
        )
      );
    });

    // Scroll indicator row
    if (showScrollIndicator) {
      const scrollText = centerVisualText(`--- ${endIdx - startIdx}/${providers.length} providers shown ---`, innerWidth);
      lines.push(
        wrapInBorders(
          <Text color={theme.textDim}>
            {scrollText}
          </Text>,
          innerWidth,
          theme.prompt,
          "scroll-indicator"
        )
      );
    }
  } else if (mode === "actions" && selectedProvider) {
    const inCodexaAvailable = selectedProvider.routeMode === "in-codexa";
    const isConfigured = inCodexaAvailable && !selectedProvider.routeUnavailableReason;
    const inCodexaStatusText = !inCodexaAvailable ? "Unavailable" : isConfigured ? "Available" : "Needs configuration";
    const inCodexaStatusColor = !inCodexaAvailable ? theme.error : isConfigured ? theme.success : theme.warning;

    // Status line
    const statusValText = padVisualText(`Status: ${selectedProvider.routeUnavailableReason ?? "Ready"}`, innerWidth);
    lines.push(wrapInBorders(<Text color={theme.textDim}>{statusValText}</Text>, innerWidth, theme.prompt, "action-status"));

    // Backend line
    const backendValText = padVisualText(`Backend: ${selectedProvider.backendType}`, innerWidth);
    lines.push(wrapInBorders(<Text color={theme.textDim}>{backendValText}</Text>, innerWidth, theme.prompt, "action-backend"));

    // Use in Codexa line
    const useInCodexaPrefix = "Use in Codexa: ";
    const useInCodexaVal = padVisualText(inCodexaStatusText, innerWidth - useInCodexaPrefix.length);
    lines.push(
      wrapInBorders(
        <Box flexDirection="row" width={innerWidth}>
          <Text color={theme.textDim}>{useInCodexaPrefix}</Text>
          <Text color={inCodexaStatusColor}>{useInCodexaVal}</Text>
        </Box>,
        innerWidth,
        theme.prompt,
        "action-use-in-codexa"
      )
    );

    // Empty line spacer
    const emptySpacedText = padVisualText("", innerWidth);
    lines.push(wrapInBorders(<Text>{emptySpacedText}</Text>, innerWidth, theme.prompt, "action-spacer"));

    // Action data rows
    visibleActions.forEach((action, idx) => {
      const realIdx = actionStartIdx + idx;
      lines.push(
        renderActionRow(
          action.label,
          action.disabledReason,
          realIdx === actionIndex,
          innerWidth,
          theme
        )
      );
    });

    // Actions scroll indicator row
    if (showActionScrollIndicator) {
      const scrollText = centerVisualText(`--- ${actionEndIdx - actionStartIdx}/${actions.length} actions shown ---`, innerWidth);
      lines.push(
        wrapInBorders(
          <Text color={theme.textDim}>
            {scrollText}
          </Text>,
          innerWidth,
          theme.prompt,
          "actions-scroll-indicator"
        )
      );
    }
  }

  // Bottom border row
  lines.push(
    <Box key="bottom" flexDirection="row" width={panelWidth} height={1} overflow="hidden">
      <Text color={theme.prompt}>└{"─".repeat(panelWidth - 2)}┘</Text>
    </Box>
  );

  return (
    <Box flexDirection="column" width="100%" alignItems="center">
      <Box flexDirection="column" width={panelWidth}>
        {lines}
      </Box>
    </Box>
  );
}
