import type {
  RunEvent,
  RunProgressBlock,
  RunResponseSegment,
  RunToolActivity,
  ShellEvent,
} from "../../../session/types.js";

// ─── Exported types ───────────────────────────────────────────────────────────

export type TimelineTone =
  | "text"
  | "dim"
  | "muted"
  | "accent"
  | "info"
  | "error"
  | "warning"
  | "success"
  | "borderSubtle"
  | "borderActive"
  | "panel"
  | "star"
  | "logoPrimary"
  | "logoSecondary"
  | "logoShadow";

export interface TimelineRowSpan {
  text: string;
  tone?: TimelineTone;
  bold?: boolean;
  backgroundTone?: TimelineTone;
}

/**
 * Marks a row as part of one bordered card so the live-region window can tell
 * whether a slice lands inside a frame. `id` is shared by every row of a card.
 */
export interface TimelineRowFrame {
  id: string;
  role: "top" | "content" | "bottom";
}

export interface TimelineRow {
  key: string;
  spans: TimelineRowSpan[];
  frame?: TimelineRowFrame;
}

export interface BuiltTimelineItem {
  key: string;
  rows: TimelineRow[];
  rowCount: number;
}

export interface TimelineSnapshot {
  items: BuiltTimelineItem[];
  rows: TimelineRow[];
  totalRows: number;
  itemCount: number;
}

export interface StableTimelineSnapshot {
  snapshot: TimelineSnapshot;
  frozenRows: TimelineRow[];
  liveRows: TimelineRow[];
}

export interface NativeTranscriptRowItem {
  key: string;
  rows: TimelineRow[];
}

export interface NativeTranscriptParts {
  staticItems: NativeTranscriptRowItem[];
  liveRows: TimelineRow[];
}

// ─── Internal types & constants ──────────────────────────────────────────────

export interface MarkdownInlinePart {
  kind: "text" | "code" | "bold";
  text: string;
}

export interface StyledToken {
  text: string;
  isWhitespace: boolean;
  isNewline: boolean;
  tone?: TimelineTone;
  bold?: boolean;
  backgroundTone?: TimelineTone;
}

export interface ActionDisplayDescriptor {
  id: string;
  status: RunToolActivity["status"];
  label: string | null;
  command: string;
  duration: string;
  summary: string;
  icon: string;
  iconTone: TimelineTone;
  showLiveCursor: boolean;
  borderTone: TimelineTone;
  width: number;
  verbose: boolean;
}

// ─── Stream event types ───────────────────────────────────────────────────────

export type StreamEvent =
  | { kind: "thinking"; streamSeq: number; block: RunProgressBlock }
  | { kind: "response"; streamSeq: number; segment: RunResponseSegment }
  | { kind: "action"; streamSeq: number; tool: RunToolActivity }
  | { kind: "actionSummary"; streamSeq: number; id: string; label: string; count: number }
  | { kind: "plan"; streamSeq: number; planText: string; approved: boolean };

import type {
  AssistantEvent,
  ErrorEvent,
  SystemEvent,
  UserPromptEvent,
} from "../../../session/types.js";
import type { Layout, StartupHeaderMode } from "../../layout.js";

import type { TurnOpacity, TurnRunPhase } from "../TurnGroup.js";

export type StandaloneTimelineEvent = SystemEvent | ErrorEvent | ShellEvent;

export interface TurnTimelineItem {
  type: "turn";
  turnId: number;
  turnIndex: number;
  user: UserPromptEvent | null;
  run: RunEvent | null;
  assistant: AssistantEvent | null;
}

export interface EventTimelineItem {
  type: "event";
  event: StandaloneTimelineEvent;
}

export type TimelineItem = TurnTimelineItem | EventTimelineItem;

export interface TurnRenderState {
  opacity: TurnOpacity;
  question: string | null;
  runPhase: TurnRunPhase;
}

export interface TurnRenderTimelineItem {
  key: string;
  type: "turn";
  padded: boolean;
  item: TurnTimelineItem;
  renderState: TurnRenderState;
}

export interface EventRenderTimelineItem {
  key: string;
  type: "event";
  padded: boolean;
  event: StandaloneTimelineEvent;
}

export interface IntroRenderTimelineItem {
  key: string;
  type: "intro";
  padded: boolean;
  intro: {
    version: string;
    layoutMode: Layout["mode"];
    startupHeaderMode?: StartupHeaderMode;
    authLabel: string;
    workspaceLabel: string;
    providerLabel?: string | null;
  };
}

export type RenderTimelineItem =
  | IntroRenderTimelineItem
  | TurnRenderTimelineItem
  | EventRenderTimelineItem;

export type TurnRenderItem = Extract<RenderTimelineItem, { type: "turn" }>;
export interface TimelineBuildOptions {
  totalWidth: number;
  verboseMode?: boolean;
  debugLabel?: string;
  workspaceRoot?: string | null;
}
