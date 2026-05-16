import React, { useMemo, useState } from "react";
import { Box, Text, useFocus, useInput } from "ink";
import type { ProviderConfig, ProviderId, ProviderPickerAction } from "../core/providerLauncher/types.js";
import { traceInputDebug } from "../core/inputDebug.js";
import { FOCUS_IDS } from "./focus.js";
import { clampVisualText, getShellWidth, type Layout } from "./layout.js";
import { useTheme } from "./theme.js";

interface ProviderPickerProps {
  layout: Layout;
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
  const shellWidth = getShellWidth(layout.cols);
  const panelWidth = Math.max(42, Math.min(shellWidth - 2, layout.mode === "full" ? 86 : 72));
  const innerWidth = Math.max(30, panelWidth - 4);
  const markerWidth = 2;
  const columnGaps = 3;
  const columnWidthBudget = Math.max(24, innerWidth - markerWidth - columnGaps);
  const statusWidth = Math.min(8, Math.max(6, columnWidthBudget - 18));
  const providerNameWidth = Math.min(layout.mode === "micro" ? 10 : 14, Math.max(8, columnWidthBudget - statusWidth - 14));
  const remainingColumnWidth = Math.max(10, columnWidthBudget - providerNameWidth - statusWidth);
  const modelWidth = Math.max(5, Math.ceil(remainingColumnWidth / 2));
  const backendWidth = Math.max(5, remainingColumnWidth - modelWidth);

  const helpText = layout.mode === "micro"
    ? "Enter select  S default  Esc"
    : "Enter = select, S = set default, Esc = cancel";
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
      { value: "refresh-models", label: "Refresh models", disabledReason: routeUnavailable },
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

  const body = useMemo(() => {
    if (mode === "actions" && selectedProvider) {
      const inCodexaAvailable = selectedProvider.routeMode === "in-codexa";
      const isConfigured = inCodexaAvailable && !selectedProvider.routeUnavailableReason;
      const inCodexaStatusText = !inCodexaAvailable ? "Unavailable" : isConfigured ? "Available" : "Needs configuration";
      const inCodexaStatusColor = !inCodexaAvailable ? theme.ERROR : isConfigured ? theme.SUCCESS : theme.WARNING;

      return (
        <Box flexDirection="column">
          <Box marginBottom={1} flexDirection="column" paddingX={2}>
            <Text color={theme.DIM}>Status: <Text color={theme.TEXT}>{selectedProvider.routeUnavailableReason ?? "Ready"}</Text></Text>
            <Text color={theme.DIM}>Backend: <Text color={theme.TEXT}>{selectedProvider.backendType}</Text></Text>
            <Text color={theme.DIM}>Use in Codexa: <Text color={inCodexaStatusColor}>{inCodexaStatusText}</Text></Text>
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

    return providers.map((provider, index) => (
      <ProviderRow
        key={provider.id}
        provider={provider}
        isHighlighted={index === providerIndex}
        widths={{ providerNameWidth, modelWidth, backendWidth, statusWidth }}
      />
    ));
  }, [actionIndex, actions, backendWidth, innerWidth, mode, modelWidth, providerIndex, providerNameWidth, providers, statusWidth]);

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
          <Text color={theme.ACCENT} bold>
            {clampVisualText(`${title}   ${helpText}`, innerWidth)}
          </Text>
        </Box>

        {mode === "providers" && (
          <Box width="100%" overflow="hidden">
            <Text color={theme.DIM}>
              {"  "}
              {clampVisualText("Provider", providerNameWidth)}
              {" "}
              {clampVisualText("Model", modelWidth)}
              {" "}
              {clampVisualText("Backend", backendWidth)}
              {" "}
              {clampVisualText("Status", statusWidth)}
            </Text>
          </Box>
        )}

        <Box flexDirection="column" marginTop={0} width="100%">
          {body}
        </Box>
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
    backendWidth: number;
    statusWidth: number;
  };
}) {
  const theme = useTheme();
  const statusColor = provider.isActiveRoute || provider.enabled ? theme.SUCCESS : theme.WARNING;
  const marker = isHighlighted ? ">" : " ";
  const defaultMark = provider.isActiveRoute ? "@" : provider.isDefault ? "*" : " ";
  const statusText = provider.isActiveRoute ? "Active" : provider.statusLabel;

  return (
    <Box width="100%" overflow="hidden">
      <Box width={2} flexShrink={0}>
        <Text color={isHighlighted ? theme.ACCENT : theme.DIM}>{marker}{defaultMark}</Text>
      </Box>
      <Box width={widths.providerNameWidth} flexShrink={0} overflow="hidden">
        <Text color={isHighlighted ? theme.TEXT : theme.MUTED} bold={isHighlighted}>
          {clampVisualText(provider.displayName, widths.providerNameWidth)}
        </Text>
      </Box>
      <Text> </Text>
      <Box width={widths.modelWidth} flexShrink={0} overflow="hidden">
        <Text color={theme.MUTED}>{clampVisualText(provider.currentModel, widths.modelWidth)}</Text>
      </Box>
      <Text> </Text>
      <Box width={widths.backendWidth} flexShrink={0} overflow="hidden">
        <Text color={theme.MUTED}>{clampVisualText(provider.backendType, widths.backendWidth)}</Text>
      </Box>
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
        <Text color={isHighlighted ? theme.ACCENT : theme.DIM}>{isHighlighted ? ">" : " "}</Text>
      </Box>
      <Box width={Math.max(10, width - 2)} flexShrink={0} overflow="hidden">
        <Text color={disabledReason ? theme.DIM : isHighlighted ? theme.TEXT : theme.MUTED} bold={isHighlighted && !disabledReason}>
          {clampVisualText(text, Math.max(10, width - 2))}
        </Text>
      </Box>
    </Box>
  );
}
