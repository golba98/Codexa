import React from "react";
import { Box, Text, useFocus, useInput } from "ink";
import { AUTH_PREFERENCES, formatAuthPreferenceLabel } from "../config/settings.js";
import type { CodexAuthProbeResult } from "../core/auth/codexAuth.js";
import { getAuthStateLabel } from "../core/auth/codexAuth.js";
import type { BackendProvider } from "../core/providers/types.js";
import { useTheme } from "./theme.js";

interface AuthPanelProps {
  focusId: string;
  provider: BackendProvider;
  authPreference: string;
  authStatus: CodexAuthProbeResult;
  authStatusBusy: boolean;
  onSetPreference: (value: string) => void;
  onRefreshAuthStatus: () => void;
  onClose: () => void;
}

export function AuthPanel({
  focusId,
  provider,
  authPreference,
  authStatus,
  authStatusBusy,
  onSetPreference,
  onRefreshAuthStatus,
  onClose,
}: AuthPanelProps) {
  const theme = useTheme();
  const { isFocused } = useFocus({ id: focusId, autoFocus: true });

  useInput((input, key) => {
    if (key.escape || input.toLowerCase() === "q") {
      onClose();
      return;
    }

    const numeric = Number.parseInt(input, 10);
    if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= AUTH_PREFERENCES.length) {
      onSetPreference(AUTH_PREFERENCES[numeric - 1]!.id);
    }

    if (input.toLowerCase() === "r") {
      onRefreshAuthStatus();
    }
  }, { isActive: isFocused });

  const authStateLabel = getAuthStateLabel(authStatus.state);
  const authStateColor =
    authStatus.state === "authenticated"
      ? theme.SUCCESS
      : authStatus.state === "unauthenticated"
        ? theme.ERROR
        : theme.WARNING;
  const checkedAtLabel = authStatus.checkedAt > 0
    ? new Date(authStatus.checkedAt).toLocaleTimeString()
    : "not checked yet";

  return (
    <Box
      borderStyle="round"
      borderColor={theme.BORDER_ACTIVE}
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      marginTop={1}
      width="100%"
    >
      <Text color={theme.ACCENT} bold>
        Auth and subscription guidance
      </Text>
      <Text color={theme.MUTED}>Current backend: {provider.label}</Text>
      <Text color={theme.MUTED}>Current preference: {formatAuthPreferenceLabel(authPreference)}</Text>
      <Text color={theme.INFO}>Backend auth: {provider.authLabel}</Text>
      <Text color={authStateColor}>Runtime auth state: {authStateLabel}</Text>
      <Text color={theme.DIM}>Last checked: {checkedAtLabel}</Text>
      <Text color={theme.DIM}>Probe summary: {authStatus.rawSummary || "No probe output yet"}</Text>
      <Text color={theme.TEXT}>
        This UI securely bridges to the Codexa neural network. It does not collect or store your ChatGPT credentials.
      </Text>
      <Text color={theme.TEXT}>{provider.statusMessage}</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text color={theme.INFO}>Commands:</Text>
        <Text color={theme.TEXT}>  /login        guided ChatGPT sign-in steps</Text>
        <Text color={theme.TEXT}>  /logout       guided sign-out steps</Text>
        <Text color={theme.TEXT}>  /auth status  refresh Codexa authentication</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {AUTH_PREFERENCES.map((item, index) => (
          <Text key={item.id} color={item.id === authPreference ? theme.SUCCESS : theme.TEXT}>
            {index + 1}. {item.label} {item.id === authPreference ? "✓" : ""}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.DIM}>
          Press 1-{AUTH_PREFERENCES.length} to change preference, R to refresh status, Esc to close.
        </Text>
      </Box>
      {authStatusBusy && (
        <Box marginTop={1}>
          <Text color={theme.WARNING}>Checking auth status...</Text>
        </Box>
      )}
      {authStatus.recommendedAction && (
        <Box marginTop={1}>
          <Text color={theme.DIM}>Next step: {authStatus.recommendedAction}</Text>
        </Box>
      )}
    </Box>
  );
}
