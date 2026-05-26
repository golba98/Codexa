import React from "react";
import { Box, Text, useFocus, useInput } from "ink";
import path from "node:path";
import { useTheme } from "./theme.js";

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

  useInput((_, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      onConfirm();
      return;
    }
  }, { isActive: isFocused });

  const relativeAttachmentsDir = path.relative(workspaceRoot, attachmentsDir).replace(/\\/g, "/");
  const hasImages = files.some((f) => f.isImage);
  const showVisionWarning = hasImages && modelSupportsVision === false;
  const fileLabel = files.length === 1 ? "file" : "files";

  return (
    <Box flexDirection="column" width="100%" marginTop={1}>
      <Box
        borderStyle="round"
        borderColor={theme.BORDER_SUBTLE}
        paddingX={2}
        paddingY={1}
        width="100%"
      >
        <Text color={theme.ACCENT} bold>IMPORT FILE  </Text>
        <Text color={theme.MUTED}>
          Copy {files.length} outside-workspace {fileLabel} into .codexa/attachments?
        </Text>
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
        {files.map((file, i) => (
          <Box key={i} flexDirection="column" marginBottom={i < files.length - 1 ? 1 : 0}>
            <Text color={theme.TEXT}>{path.basename(file.srcPath)}</Text>
            <Text color={theme.DIM}>
              {"→ "}{relativeAttachmentsDir}/{file.destFilename}
            </Text>
          </Box>
        ))}

        {showVisionWarning && (
          <Box marginTop={1}>
            <Text color={theme.WARNING}>
              Note: active model may not support images.
            </Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text color={theme.DIM}>Enter copy and continue  Esc cancel</Text>
        </Box>
      </Box>
    </Box>
  );
}
