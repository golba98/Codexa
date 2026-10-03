import { APP_VERSION } from "../../config/settings.js";
import type { CodexAuthState } from "../../core/codex/codexAuth.js";
import { getAuthStateLabel } from "../../core/codex/codexAuth.js";

import { formatUbumeVersionLabel } from "../../core/version/channel.js";
import {
  getRunPlanText,
  type RunEvent,
  type TimelineEvent,
  type UIState,
} from "../../session/types.js";
import type { Layout, StartupHeaderMode } from "../layout.js";

import type {
  IntroRenderTimelineItem,
  RenderTimelineItem,
  StandaloneTimelineEvent,
  TimelineItem,
  TurnTimelineItem,
} from "./measure/types.js";
import { resolveTurnRunPhase, type TurnOpacity } from "./TurnGroup.js";

// ─── Viewport helpers ────────────────────────────────────────────────────────

export function isStandaloneEvent(event: TimelineEvent): event is StandaloneTimelineEvent {
  return event.type === "system" || event.type === "error" || event.type === "shell";
}

export function getActiveTurnId(uiState: UIState): number | null {
  return uiState.kind === "THINKING" ||
    uiState.kind === "RESPONDING" ||
    uiState.kind === "ANSWER_VISIBLE" ||
    uiState.kind === "AWAITING_USER_ACTION" ||
    uiState.kind === "ERROR"
    ? uiState.turnId
    : null;
}

export function isBusyUiState(uiState: UIState): boolean {
  return (
    uiState.kind === "THINKING" ||
    uiState.kind === "RESPONDING" ||
    uiState.kind === "ANSWER_VISIBLE" ||
    uiState.kind === "SHELL_RUNNING"
  );
}

export function getRunningTurnIds(events: TimelineEvent[]): number[] {
  return events
    .filter((event): event is RunEvent => event.type === "run" && event.status === "running")
    .map((event) => event.turnId);
}

export function getFinalizedTurnIds(events: TimelineEvent[]): number[] {
  return events
    .filter((event): event is RunEvent => event.type === "run" && event.status !== "running")
    .map((event) => event.turnId);
}

export function latestFinalizedRunEndsWithPlan(events: TimelineEvent[]): boolean {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || event.type !== "run" || event.status === "running") {
      continue;
    }

    const lastStreamItem = (event.streamItems ?? [])
      .slice()
      .sort((left, right) => left.streamSeq - right.streamSeq)
      .at(-1);
    return (
      lastStreamItem?.kind === "plan" &&
      event.plan?.status === "completed" &&
      getRunPlanText(event.plan).trim().length > 0
    );
  }

  return false;
}

export function hasFinalizeTransition(params: {
  previousRunningTurnIds: number[];
  nextRunningTurnIds: number[];
  nextFinalizedTurnIds: number[];
  previousBusy: boolean;
  nextBusy: boolean;
}): boolean {
  if (!params.previousBusy || params.nextBusy) return false;
  return params.previousRunningTurnIds.some(
    (turnId) =>
      !params.nextRunningTurnIds.includes(turnId) && params.nextFinalizedTurnIds.includes(turnId),
  );
}

// ─── Timeline item builders ───────────────────────────────────────────────────

export function buildTimelineItems(events: TimelineEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const turns = new Map<number, TurnTimelineItem>();
  let nextTurnIndex = 1;

  for (const event of events) {
    if (isStandaloneEvent(event)) {
      items.push({ type: "event", event });
      continue;
    }

    const turnId = event.turnId;
    let turn = turns.get(turnId);
    if (!turn) {
      turn = {
        type: "turn",
        turnId,
        turnIndex: nextTurnIndex++,
        user: null,
        run: null,
        assistant: null,
      };
      turns.set(turnId, turn);
      items.push(turn);
    }

    if (event.type === "user") {
      turn.user = event;
    } else if (event.type === "run") {
      turn.run = event;
    } else if (event.type === "assistant") {
      turn.assistant = event;
    }
  }

  return items.filter((item) => item.type === "event" || item.user !== null);
}

export type TurnOpacityResolver = (turnId: number, activeTurnId: number | null) => TurnOpacity;

/**
 * Build a resolver once per render pass so resolving every turn's opacity is
 * O(turns) instead of O(turns²) (two indexOf scans per turn). Semantics match
 * resolveTurnOpacity exactly, including the "absent id → index -1" behaviour.
 */
export function createTurnOpacityResolver(turnIds: number[]): TurnOpacityResolver {
  const indexById = new Map<number, number>();
  turnIds.forEach((id, index) => indexById.set(id, index));
  const lastTurnId = turnIds[turnIds.length - 1];
  return (turnId, activeTurnId) => {
    if (turnIds.length === 0) return "dim";
    if (activeTurnId === null) {
      return turnId === lastTurnId ? "recent" : "dim";
    }
    const activeIndex = indexById.get(activeTurnId) ?? -1;
    const currentIndex = indexById.get(turnId) ?? -1;
    if (currentIndex === activeIndex) return "active";
    if (currentIndex === activeIndex - 1) return "recent";
    return "dim";
  };
}

export function resolveTurnOpacity(
  turnIds: number[],
  turnId: number,
  activeTurnId: number | null,
): TurnOpacity {
  return createTurnOpacityResolver(turnIds)(turnId, activeTurnId);
}

export function buildStaticRenderItems(
  items: TimelineItem[],
  turnIds: number[],
  activeTurnId: number | null,
  questionTurnId: number | null,
  question: string | null,
): RenderTimelineItem[] {
  const resolveOpacity = createTurnOpacityResolver(turnIds);
  return items.map((item) => {
    if (item.type === "event") {
      return {
        key: `event-${item.event.id}`,
        type: "event",
        padded: false,
        event: item.event,
      };
    }

    return {
      key: `turn-${item.turnId}`,
      type: "turn",
      padded: false,
      item,
      renderState: {
        opacity: resolveOpacity(item.turnId, activeTurnId),
        question: questionTurnId === item.turnId ? question : null,
        runPhase: resolveTurnRunPhase(item.run, item.assistant, { kind: "IDLE" }, item.turnId),
      },
    };
  });
}

export function buildActiveRenderItems(
  items: TimelineItem[],
  turnIds: number[],
  uiState: UIState,
): RenderTimelineItem[] {
  const activeTurnId = getActiveTurnId(uiState);
  const questionTurnId = uiState.kind === "AWAITING_USER_ACTION" ? uiState.turnId : null;
  const question = uiState.kind === "AWAITING_USER_ACTION" ? uiState.question : null;
  const resolveOpacity = createTurnOpacityResolver(turnIds);

  return items.map((item) => {
    if (item.type === "event") {
      return {
        key: `event-${item.event.id}`,
        type: "event",
        padded: true,
        event: item.event,
      };
    }

    return {
      key: `turn-${item.turnId}`,
      type: "turn",
      padded: false,
      item,
      renderState: {
        opacity: resolveOpacity(item.turnId, activeTurnId),
        question: questionTurnId === item.turnId ? question : null,
        runPhase: resolveTurnRunPhase(item.run, item.assistant, uiState, item.turnId),
      },
    };
  });
}

export function formatAuthLabel(authState: CodexAuthState): string {
  const raw = getAuthStateLabel(authState);
  return raw.length > 0 ? raw[0]!.toUpperCase() + raw.slice(1) : raw;
}

export function buildIntroRenderItem(params: {
  authState: CodexAuthState;
  workspaceLabel: string;
  layout: Layout;
  startupHeaderMode?: StartupHeaderMode;
  providerLabel?: string | null;
}): IntroRenderTimelineItem {
  return {
    key: "ubume-intro",
    type: "intro",
    padded: true,
    intro: {
      version: formatUbumeVersionLabel(APP_VERSION),
      layoutMode: params.layout.mode,
      startupHeaderMode: params.startupHeaderMode,
      authLabel: formatAuthLabel(params.authState),
      workspaceLabel: params.workspaceLabel,
      providerLabel: params.providerLabel ?? null,
    },
  };
}
