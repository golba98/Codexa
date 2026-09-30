import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useFocus, useInput } from "ink";
import { externalSourceLabel, type ExternalSessionSource, type ExternalSessionSummary } from "../../core/externalSessions/types.js";
import type { ConversationListEntry } from "../../core/workspace/conversationStore.js";
import { clampVisualText, usePanelLayout } from "../layout.js";
import { useTheme } from "../theme.js";
import { calculateResponsivePickerViewport } from "./responsivePickerViewport.js";
import {
  RESUME_PICKER_TABS,
  externalRowText,
  matchesQuery,
  nextResumeTab,
  resumeTabLabel,
  ubumeRowText,
  type ExternalListScope,
  type ResumePickerPosition,
  type ResumePickerTab,
} from "./resumePickerRows.js";

interface ResumePickerProps {
  conversations: readonly ConversationListEntry[];
  onSelect: (id: string) => void;
  onCancel: () => void;
  /** Enables the Claude Code / Codex / Antigravity sections. */
  loadExternalSessions?: (source: ExternalSessionSource, scope: ExternalListScope) => Promise<ExternalSessionSummary[]>;
  onOpenExternal?: (summary: ExternalSessionSummary) => void;
  onResumeExternalNative?: (summary: ExternalSessionSummary) => void;
  onContinueExternal?: (summary: ExternalSessionSummary) => void;
  position?: ResumePickerPosition;
  onPositionChange?: (position: ResumePickerPosition) => void;
}

type ExternalListState =
  | { status: "loading" }
  | { status: "ready"; sessions: ExternalSessionSummary[] }
  | { status: "error"; message: string };

type PickerItem =
  | { kind: "ubume"; id: string; text: string }
  | { kind: "external"; id: string; text: string; summary: ExternalSessionSummary };

const listKey = (source: ExternalSessionSource, scope: ExternalListScope) => `${source}:${scope}`;

export function ResumePicker({
  conversations,
  onSelect,
  onCancel,
  loadExternalSessions,
  onOpenExternal,
  onResumeExternalNative,
  onContinueExternal,
  position,
  onPositionChange,
}: ResumePickerProps) {
  const theme = useTheme();
  const panelLayout = usePanelLayout();
  const { isFocused } = useFocus({ id: "resume-picker", autoFocus: true });
  const externalEnabled = Boolean(loadExternalSessions);
  const [tab, setTab] = useState<ResumePickerTab>(externalEnabled ? position?.tab ?? "ubume" : "ubume");
  const [scope, setScope] = useState<ExternalListScope>(position?.scope ?? "workspace");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [lists, setLists] = useState<Record<string, ExternalListState>>({});
  const pendingSelectionRef = useRef(position?.selectedId ?? null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const externalState = tab === "ubume" ? undefined : lists[listKey(tab, scope)];

  useEffect(() => {
    if (tab === "ubume" || !loadExternalSessions) return;
    const key = listKey(tab, scope);
    if (lists[key]) return;
    setLists((current) => ({ ...current, [key]: { status: "loading" } }));
    loadExternalSessions(tab, scope).then(
      (sessions) => { if (mountedRef.current) setLists((current) => ({ ...current, [key]: { status: "ready", sessions } })); },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : "unknown error";
        if (mountedRef.current) setLists((current) => ({ ...current, [key]: { status: "error", message } }));
      },
    );
  }, [lists, loadExternalSessions, scope, tab]);

  const items = useMemo((): PickerItem[] => {
    if (tab === "ubume") {
      return conversations
        .filter((item) => matchesQuery([item.title, item.modelId, item.id], query))
        .map((item) => ({ kind: "ubume", id: item.id, text: ubumeRowText(item) }));
    }
    if (externalState?.status !== "ready") return [];
    return externalState.sessions
      .filter((summary) => matchesQuery([summary.title, summary.cwd, summary.id, summary.model], query))
      .map((summary) => ({ kind: "external", id: summary.id, text: externalRowText(summary, scope), summary }));
  }, [conversations, externalState, query, scope, tab]);

  const availableRows = Math.max(1, panelLayout?.availableRows ?? 12);
  const width = Math.max(1, (panelLayout?.availableCols ?? 80) - 2);
  const viewport = useMemo(() => calculateResponsivePickerViewport({
    itemCount: items.length,
    selectedIndex,
    availableRows,
    chromeRows: availableRows >= 3 ? 2 : 0,
    scrollOffset,
  }), [availableRows, items.length, scrollOffset, selectedIndex]);

  useEffect(() => {
    const pending = pendingSelectionRef.current;
    if (pending && items.length > 0) {
      pendingSelectionRef.current = null;
      const index = items.findIndex((item) => item.id === pending);
      if (index >= 0) { setSelectedIndex(index); return; }
    }
    setSelectedIndex((index) => Math.max(0, Math.min(index, items.length - 1)));
  }, [items]);
  useEffect(() => setScrollOffset(viewport.start), [viewport.start]);

  const selected = items[selectedIndex];
  useEffect(() => {
    onPositionChange?.({ tab, scope, selectedId: selected?.id ?? null });
  }, [onPositionChange, scope, selected?.id, tab]);

  const switchTab = (next: ResumePickerTab) => {
    if (next === tab) return;
    pendingSelectionRef.current = null;
    setTab(next);
    setQuery("");
    setSearching(false);
    setSelectedIndex(0);
    setScrollOffset(0);
  };

  const move = (index: number) => setSelectedIndex(Math.max(0, Math.min(index, items.length - 1)));
  useInput((input, key) => {
    if (searching) {
      if (key.escape) { setSearching(false); setQuery(""); return; }
      if (key.return) { setSearching(false); return; }
      if (key.backspace || key.delete) setQuery((text) => text.slice(0, -1));
      else if (!key.ctrl && !key.meta && input) setQuery((text) => text + input);
      setSelectedIndex(0);
      return;
    }
    if (input === "/") { setSearching(true); return; }
    if (key.escape) return onCancel();
    if (externalEnabled) {
      // Tab is Ink's focus-cycling key, so sections move with ←/→ or 1–4.
      if (key.leftArrow) return switchTab(nextResumeTab(tab, -1));
      if (key.rightArrow) return switchTab(nextResumeTab(tab, 1));
      const numbered = RESUME_PICKER_TABS[Number(input) - 1];
      if (/^[1-4]$/.test(input) && numbered) return switchTab(numbered);
      if (input === "a" && tab !== "ubume") {
        pendingSelectionRef.current = null;
        setScope((current) => current === "workspace" ? "all" : "workspace");
        setSelectedIndex(0);
        setScrollOffset(0);
        return;
      }
    }
    if (key.return) {
      if (selected?.kind === "ubume") onSelect(selected.id);
      else if (selected?.kind === "external") onOpenExternal?.(selected.summary);
      return;
    }
    if (selected?.kind === "external") {
      if (input === "o") return onResumeExternalNative?.(selected.summary);
      if (input === "c") return onContinueExternal?.(selected.summary);
    }
    if (key.upArrow || input === "k") return move(selectedIndex - 1);
    if (key.downArrow || input === "j") return move(selectedIndex + 1);
    if (key.home) return move(0);
    if (key.end) return move(items.length - 1);
    if (key.pageUp) return move(selectedIndex - Math.max(1, viewport.capacity));
    if (key.pageDown) return move(selectedIndex + Math.max(1, viewport.capacity));
  }, { isActive: isFocused });

  const status = searching
    ? `Search: ${query}`
    : [
      ...(tab === "ubume" ? [] : [scope === "workspace" ? "This folder" : "All projects"]),
      ...(query ? [`“${query}”`] : []),
      ...(items.length > 0 ? [`${selectedIndex + 1}/${items.length}`] : []),
    ].join(" · ");

  let emptyMessage: string | null = null;
  if (items.length === 0) {
    if (tab === "ubume") emptyMessage = query ? "No conversations match your search." : "No previous conversations found.";
    else {
      const label = externalSourceLabel(tab);
      if (!externalState || externalState.status === "loading") emptyMessage = `Loading ${label} sessions…`;
      else if (externalState.status === "error") emptyMessage = `Could not read ${label} sessions: ${externalState.message}`;
      else if (query) emptyMessage = "No sessions match your search.";
      else emptyMessage = scope === "workspace" ? `No ${label} sessions in this folder — press a for all projects.` : `No ${label} sessions found.`;
    }
  }

  const hint = tab === "ubume"
    ? `↑↓ navigate · / search · Enter resume${externalEnabled ? " · ←→ section" : ""} · Esc cancel`
    : `Enter view · o open in ${externalSourceLabel(tab)} · c continue here · a ${scope === "workspace" ? "all projects" : "this folder"} · / search · ←→ section · Esc close`;

  return (
    <Box borderStyle={availableRows >= 3 ? "round" : undefined} borderColor={theme.borderFocused} paddingX={availableRows >= 3 ? 1 : 0} width="100%" flexDirection="column" overflow="hidden">
      {availableRows >= 3 && (externalEnabled ? (
        <Text wrap="truncate">
          <Text color={theme.accent} bold>Resume </Text>
          {RESUME_PICKER_TABS.map((item, index) => (
            <Text key={item} color={item === tab ? theme.accent : theme.textMuted} bold={item === tab} underline={item === tab}>
              {index > 0 ? "  " : ""}{resumeTabLabel(item)}
            </Text>
          ))}
          {status ? <Text color={theme.textMuted}>{`  · ${status}`}</Text> : null}
        </Text>
      ) : (
        <Text color={theme.accent} bold>Resume Conversation{status ? ` · ${status}` : ""}</Text>
      ))}
      {emptyMessage && <Text color={externalState?.status === "error" ? theme.error : theme.textMuted} wrap="truncate">{emptyMessage}</Text>}
      {items.slice(viewport.start, viewport.end).map((item, offset) => {
        const isSelected = viewport.start + offset === selectedIndex;
        return <Text key={`${item.kind}:${item.id}`} color={isSelected ? theme.accent : theme.textMuted} bold={isSelected} wrap="truncate">
          {isSelected ? "> " : "  "}{clampVisualText(item.text, Math.max(1, width - 2))}
        </Text>;
      })}
      {availableRows >= 3 && <Text color={theme.textDim} wrap="truncate">{hint}</Text>}
    </Box>
  );
}
