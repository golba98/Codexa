import React from "react";
import { Box, Text } from "ink";
import type { CodexAuthState } from "../core/auth/codexAuth.js";
import { getAuthStateLabel } from "../core/auth/codexAuth.js";
import { truncatePath } from "./displayText.js";
import { useTheme } from "./theme.js";
import type { Layout } from "./layout.js";
import { APP_VERSION } from "../config/settings.js";

// Compact blocky logo matching the "terminal-native" style
const CODEXA_LOGO = [
  " ██████╗ ██████╗ ██████╗ ███████╗██╗  ██╗ █████╗ ",
  "██╔════╝██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝██╔══██╗",
  "██║     ██║   ██║██║  ██║█████╗   ╚███╔╝ ███████║",
  "██║     ██║   ██║██║  ██║██╔══╝   ██╔██╗ ██╔══██║",
  "╚██████╗╚██████╔╝██████╔╝███████╗██╔╝ ██╗██║  ██║",
  " ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝",
];

const CODEXA_LOGO_COMPACT = [
  " ___ ___  ___  ___ _  __ _ ",
  "/ __/ _ \\|   \\| __\\ \\/ // _\\",
  "\\___\\___/|___/|___/_/\\_/_/ \\_\\",
];

interface TopHeaderProps {
  authState: CodexAuthState;
  workspaceRoot: string;
  layout: Layout;
}

export function TopHeader({ authState, workspaceRoot, layout }: TopHeaderProps) {
  const { contentWidth, mode } = layout;
  const theme = useTheme();

  const authLabelRaw = getAuthStateLabel(authState);
  const authLabel = authLabelRaw.length > 0
    ? authLabelRaw[0]!.toUpperCase() + authLabelRaw.slice(1)
    : authLabelRaw;

  const logo = mode === "full" ? CODEXA_LOGO : CODEXA_LOGO_COMPACT;
  const logoWidth = mode === "full" ? 49 : 28;
  const metaWidth = Math.max(20, contentWidth - logoWidth - 2);
  const workspaceLine = truncatePath(workspaceRoot, Math.max(10, metaWidth - 11));

  return (
    <Box 
      flexDirection="row" 
      paddingX={1} 
      paddingY={0}
      width="100%" 
      height={mode === "full" ? 6 : 3} 
      alignItems="flex-start" 
      marginBottom={1}
    >
      <Box flexDirection="column" width={logoWidth} flexShrink={0}>
        {logo.map((line, i) => (
          <Text key={i} color={theme.TEXT} bold>{line}</Text>
        ))}
      </Box>

      <Box flexDirection="row" marginLeft={2} flexGrow={1} justifyContent="flex-end">
        <Box flexDirection="column" alignItems="flex-start">
          <Box flexDirection="row">
            <Box width={11} alignItems="flex-end" marginRight={1}>
              <Text color={theme.DIM}>CODEXA</Text>
            </Box>
            <Text color={theme.TEXT} bold>v{APP_VERSION}</Text>
          </Box>
          <Box flexDirection="row">
            <Box width={11} alignItems="flex-end" marginRight={1}>
              <Text color={theme.DIM}>Auth:</Text>
            </Box>
            <Text color={authState === "authenticated" ? theme.SUCCESS : theme.WARNING} bold>
              {authLabel}
            </Text>
          </Box>
          <Box flexDirection="row" overflow="hidden">
            <Box width={11} alignItems="flex-end" marginRight={1}>
              <Text color={theme.DIM}>Workspace:</Text>
            </Box>
            <Text color={theme.DIM}>{workspaceLine}</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

