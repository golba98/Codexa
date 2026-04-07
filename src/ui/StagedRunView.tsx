/**
 * StagedRunView — composite view that assembles all panels based on PanelState.
 * This is the main staged rendering component for active runs.
 */

import React from "react";
import { Box } from "ink";
import {
  hasVisibleThinking,
  hasVisibleFiles,
  hasVisibleTools,
  hasVisibleResult,
  hasVisibleDiffs,
  hasVisibleCommands,
  isRunActive,
  type PanelState,
} from "../orchestration/panelState.js";
import { StatusPanel } from "./panels/StatusPanel.js";
import { ThinkingPanel } from "./panels/ThinkingPanel.js";
import { FilesPanel } from "./panels/FilesPanel.js";
import { ActivityPanel } from "./panels/ActivityPanel.js";
import { ResultPanel } from "./panels/ResultPanel.js";
import { DiffPanel } from "./panels/DiffPanel.js";
import { CommandPanel } from "./panels/CommandPanel.js";

interface StagedRunViewProps {
  cols: number;
  state: PanelState;
  model?: string;
}

export function StagedRunView({ cols, state, model }: StagedRunViewProps) {
  const active = isRunActive(state);
  const showStatus = Boolean(state.status);
  const showThinking = hasVisibleThinking(state);
  const showFiles = hasVisibleFiles(state);
  const showTools = hasVisibleTools(state);
  const showResult = hasVisibleResult(state);
  const showDiffs = hasVisibleDiffs(state);
  const showCommands = hasVisibleCommands(state);

  // Determine if we're in streaming mode
  const isStreaming = state.runPhase === "responding";

  // Use simple mode when active and no significant activity yet
  const useSimpleMode = active && !showFiles && !showTools && !showDiffs && !showCommands;

  return (
    <Box flexDirection="column" width="100%">
      {/* Status line */}
      {showStatus && (
        <StatusPanel
          message={state.status}
          taskLabel={state.taskType ? formatTaskType(state.taskType) : undefined}
          showSpinner={active}
          simple={useSimpleMode}
        />
      )}

      {/* Thinking/progress panel */}
      {showThinking && !useSimpleMode && (
        <ThinkingPanel
          cols={cols}
          title={state.thinkingTitle || "Processing"}
          summaries={state.thinkingSummaries}
          active={state.thinkingActive}
        />
      )}

      {/* Files panel */}
      {showFiles && (
        <FilesPanel
          cols={cols}
          title={state.filesTitle || "Files Inspected"}
          files={state.files}
          complete={state.filesComplete}
          totalCount={state.filesTotalCount}
        />
      )}

      {/* Tool activity panel */}
      {showTools && (
        <ActivityPanel
          cols={cols}
          title="Activity"
          tools={state.tools}
        />
      )}

      {/* Result panel */}
      {showResult && (
        <ResultPanel
          cols={cols}
          sections={state.sections}
          partialContent={state.partialContent}
          finalContent={state.finalContent}
          streaming={isStreaming}
          model={model}
          durationMs={state.durationMs}
        />
      )}

      {/* Diff panel */}
      {showDiffs && (
        <DiffPanel
          cols={cols}
          diffs={state.diffs}
        />
      )}

      {/* Command panel */}
      {showCommands && (
        <CommandPanel
          cols={cols}
          commands={state.commands}
        />
      )}
    </Box>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTaskType(taskType: string): string {
  const labels: Record<string, string> = {
    "code-suggest": "Suggestions",
    "code-review": "Review",
    "bug-fix": "Bug Fix",
    refactor: "Refactor",
    explain: "Explain",
    feature: "Feature",
    general: "Task",
  };
  return labels[taskType] ?? "Task";
}
