import React, { useState } from "react";
import { Box, Text, useFocus, useInput } from "ink";
import path from "node:path";
import { useTheme } from "../theme.js";

export interface PendingImportFile {
  srcPath: string;
  rawPath: string;
  destFilename: string;
  isImage: boolean;
}

interface AttachmentImportPanelProps {
  focusId: string;
  files: PendingImportFile[];
  attachmentsDir: string;
  workspaceRoot: string;
  modelSupportsVision: boolean | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AttachmentImportPanel({
  focusId,
  files,
  attachmentsDir,
  workspaceRoot,
  modelSupportsVision,
  onConfirm,
  onCancel,
}: AttachmentImportPanelProps) {
  const theme = useTheme();
  const { isFocused } = useFocus({ id: focusId, autoFocus: true });
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      if (selectedIndex === 0) onConfirm();
      else onCancel();
      return;
    }
    if (key.upArrow || key.leftArrow || input === "k") setSelectedIndex(0);
    if (key.downArrow || key.rightArrow || key.tab || input === "j") setSelectedIndex(1);
  }, { isActive: isFocused });

  const relativeAttachmentsDir = path.relative(workspaceRoot, attachmentsDir).replace(/\\/g, "/");
  const displayedAttachmentsDir = relativeAttachmentsDir.startsWith("..") ? attachmentsDir : relativeAttachmentsDir;
  const hasImages = files.some((f) => f.isImage);
  const showVisionWarning = hasImages && modelSupportsVision === false;
  const fileLabel = files.length === 1 ? "file" : "files";

  return (
    <Box flexDirection="column" width="100%" marginTop={1}>
      <Box
        borderStyle="round"
        borderColor={theme.border}
        paddingX={2}
        paddingY={1}
        width="100%"
      >
        <Text color={theme.accent} bold>IMPORT FILE  </Text>
        <Text color={theme.textMuted}>
          Copy {files.length} outside-workspace {fileLabel} into {displayedAttachmentsDir}?
        </Text>
      </Box>

      <Box
        borderStyle="round"
        borderColor={theme.border}
        paddingX={2}
        paddingY={1}
        marginTop={1}
        width="100%"
        flexDirection="column"
      >
        {files.map((file, i) => (
          <Box key={i} flexDirection="column" marginBottom={i < files.length - 1 ? 1 : 0}>
            <Text color={theme.text}>{path.basename(file.srcPath)}</Text>
            <Text color={theme.textDim}>
              {"→ "}{displayedAttachmentsDir}/{file.destFilename}
            </Text>
          </Box>
        ))}

        {showVisionWarning && (
          <Box marginTop={1}>
            <Text color={theme.warning}>
              Note: active model may not support images.
            </Text>
          </Box>
        )}

        <Box marginTop={1} flexDirection="column">
          <Text color={selectedIndex === 0 ? theme.accent : theme.textMuted} bold={selectedIndex === 0}>
            {selectedIndex === 0 ? "› " : "  "}Import once
          </Text>
          <Text color={selectedIndex === 1 ? theme.accent : theme.textMuted} bold={selectedIndex === 1}>
            {selectedIndex === 1 ? "› " : "  "}Cancel
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text color={theme.textMuted}>
            This copies only the listed {fileLabel}; it does not grant folder or workspace access.
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text color={theme.textDim}>↑/↓ or j/k to navigate · Enter to select · Esc to cancel</Text>
        </Box>
      </Box>
    </Box>
  );
}
