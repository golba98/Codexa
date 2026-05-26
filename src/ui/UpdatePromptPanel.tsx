import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useFocus, useInput } from "ink";
import { spawn } from "child_process";
import { useTheme } from "./theme.js";
import { CODEXA_NPM_PACKAGE, CODEXA_UPDATE_COMMAND } from "../core/updateCheck.js";

type Phase = "menu" | "running" | "done" | "error";

const MENU_ITEMS = [
  { label: "Update now" },
  { label: "Skip" },
  { label: "Skip until next version" },
] as const;

interface UpdatePromptPanelProps {
  focusId: string;
  currentVersion: string;
  latestVersion: string;
  onSkip: () => void;
  onSkipUntilNextVersion: (version: string) => void;
}

export function UpdatePromptPanel({
  focusId,
  currentVersion,
  latestVersion,
  onSkip,
  onSkipUntilNextVersion,
}: UpdatePromptPanelProps) {
  const theme = useTheme();
  const { isFocused } = useFocus({ id: focusId, autoFocus: true });

  const [phase, setPhase] = useState<Phase>("menu");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const spawnStartedRef = useRef(false);

  useInput((input, key) => {
    if (phase === "menu") {
      if (key.upArrow || input === "k") {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        setSelectedIndex((i) => Math.min(MENU_ITEMS.length - 1, i + 1));
        return;
      }
      if (key.return) {
        if (selectedIndex === 0) {
          setPhase("running");
        } else if (selectedIndex === 1) {
          onSkip();
        } else {
          onSkipUntilNextVersion(latestVersion);
        }
        return;
      }
      if (key.escape) {
        onSkip();
        return;
      }
    } else if (phase === "done" || phase === "error") {
      if (key.return || key.escape) {
        onSkip();
      }
    }
  }, { isActive: isFocused });

  useEffect(() => {
    if (phase !== "running") return;
    if (spawnStartedRef.current) return;
    spawnStartedRef.current = true;

    const child = spawn("npm", ["install", "-g", `${CODEXA_NPM_PACKAGE}@latest`], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const appendLines = (buf: Buffer) => {
      const lines = buf.toString("utf8").split(/\r?\n/).filter(Boolean);
      if (lines.length > 0) {
        setOutputLines((prev) => [...prev, ...lines]);
      }
    };

    child.stdout?.on("data", appendLines);
    child.stderr?.on("data", appendLines);

    child.once("error", (err: Error) => {
      setErrorMessage(err.message);
      setPhase("error");
    });

    child.once("close", (code: number | null) => {
      if (code === 0) {
        setPhase("done");
      } else {
        setErrorMessage(`npm exited with code ${code ?? "unknown"}.`);
        setPhase("error");
      }
    });

    return () => {
      try { child.kill(); } catch { /* ignore */ }
    };
  }, [phase]);

  const hintText = phase === "menu"
    ? "↑↓/jk select  Enter confirm  Esc skip"
    : "Press Enter to close";

  return (
    <Box flexDirection="column" width="100%" marginTop={1}>
      <Box
        borderStyle="round"
        borderColor={theme.BORDER_SUBTLE}
        paddingX={2}
        paddingY={1}
        width="100%"
        flexDirection="column"
      >
        <Box>
          <Text color={theme.ACCENT} bold>Update available  </Text>
          <Text color={theme.MUTED}>{hintText}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.TEXT}>{`✨ ${currentVersion} -> ${latestVersion}`}</Text>
        </Box>
        <Box>
          <Text color={theme.MUTED}>{`Package: ${CODEXA_NPM_PACKAGE}`}</Text>
        </Box>
        <Box>
          <Text color={theme.MUTED}>{`Run: ${CODEXA_UPDATE_COMMAND}`}</Text>
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
        {phase === "menu" && (
          <>
            {MENU_ITEMS.map((item, index) => (
              <Box key={item.label}>
                <Text color={index === selectedIndex ? theme.ACCENT : theme.MUTED}>
                  {index === selectedIndex ? "› " : "  "}
                </Text>
                <Text
                  color={index === selectedIndex ? theme.TEXT : theme.MUTED}
                  bold={index === selectedIndex}
                >
                  {`${index + 1}. ${item.label}`}
                </Text>
              </Box>
            ))}
            <Box marginTop={1}>
              <Text color={theme.DIM}>Press enter to continue</Text>
            </Box>
          </>
        )}

        {phase === "running" && (
          <>
            <Text color={theme.TEXT}>{`Installing Codexa ${latestVersion}...`}</Text>
            {outputLines.map((line, i) => (
              <Text key={i} color={theme.MUTED}>{line}</Text>
            ))}
          </>
        )}

        {phase === "done" && (
          <>
            <Text color={theme.SUCCESS}>{"Codexa was updated successfully."}</Text>
            <Text color={theme.MUTED}>{"Restart Codexa to use the new version."}</Text>
            <Box marginTop={1}>
              <Text color={theme.DIM}>Press Enter to close</Text>
            </Box>
          </>
        )}

        {phase === "error" && (
          <>
            <Text color={theme.ERROR}>{"Update failed."}</Text>
            {errorMessage != null && <Text color={theme.MUTED}>{errorMessage}</Text>}
            {outputLines.slice(-5).map((line, i) => (
              <Text key={i} color={theme.DIM}>{line}</Text>
            ))}
            <Box marginTop={1}>
              <Text color={theme.DIM}>Press Enter to close</Text>
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}
