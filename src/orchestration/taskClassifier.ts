/**
 * Task classifier — analyzes user prompts to determine task type.
 * Task type influences which panels to emphasize and how to structure the response.
 */

import type { TaskType } from "./events.js";

// ─── Task Pattern Definitions ─────────────────────────────────────────────────

interface TaskPattern {
  type: TaskType;
  patterns: RegExp[];
  priority: number; // Higher priority patterns are checked first
}

const TASK_PATTERNS: TaskPattern[] = [
  {
    type: "code-review",
    priority: 10,
    patterns: [
      /review\s+(this\s+)?(code|file|changes?|pr|pull\s*request)/i,
      /what('?s|\s+is)\s+wrong\s+with/i,
      /find\s+(issues?|problems?|bugs?|errors?|mistakes?)/i,
      /check\s+(this|the|my)\s+(code|file|implementation)/i,
      /audit\s+(this|the|my)\s+(code|file)/i,
      /look\s+(at|over|through)\s+(this|the|my)\s+(code|file)/i,
      /spot\s+(any\s+)?(issues?|problems?|bugs?)/i,
      /anything\s+wrong\s+(with|here)/i,
      /critique\s+(this|the|my)/i,
    ],
  },
  {
    type: "code-suggest",
    priority: 9,
    patterns: [
      /suggest(ions?)?\s+(for\s+)?(code|improvement|change)/i,
      /how\s+(can|could|should)\s+I\s+improve/i,
      /what\s+(can|could|should)\s+I\s+(change|improve|do\s+better)/i,
      /improve\s+(this|the|my)\s+(code|file|implementation)/i,
      /make\s+(this|it)\s+(better|cleaner|more\s+efficient)/i,
      /optimize\s+(this|the|my)/i,
      /any\s+(suggestions?|recommendations?|improvements?)/i,
      /ways?\s+to\s+(improve|enhance|optimize)/i,
      /best\s+practices?\s+for/i,
    ],
  },
  {
    type: "bug-fix",
    priority: 10,
    patterns: [
      /fix\s+(this|the|my)?\s*(bug|issue|error|problem|crash)/i,
      /debug\s+(this|the|my)/i,
      /why\s+(is|does|doesn't|isn't)\s+(this|it)\s+(not\s+work|fail|crash|error|break)/i,
      /not\s+working/i,
      /doesn('?t|'t)\s+work/i,
      /throws?\s+(an?\s+)?(error|exception)/i,
      /getting\s+(an?\s+)?(error|exception|crash)/i,
      /broken/i,
      /troubleshoot/i,
      /diagnose/i,
    ],
  },
  {
    type: "refactor",
    priority: 8,
    patterns: [
      /refactor\s+(this|the|my)/i,
      /clean\s+up\s+(this|the|my)/i,
      /restructure\s+(this|the|my)/i,
      /simplify\s+(this|the|my)/i,
      /reorganize\s+(this|the|my)/i,
      /split\s+(this|the)\s+(into|up)/i,
      /extract\s+(this|the|a)\s+(function|method|class|component)/i,
      /modularize/i,
      /reduce\s+(complexity|duplication)/i,
      /dry\s+(this|up|out)/i,
    ],
  },
  {
    type: "explain",
    priority: 7,
    patterns: [
      /explain\s+(this|the|how|what|why)/i,
      /what\s+does\s+(this|it|the\s+\w+)\s+do/i,
      /how\s+does\s+(this|it|the\s+\w+)\s+work/i,
      /walk\s+me\s+through/i,
      /break\s+(this|it)\s+down/i,
      /help\s+me\s+understand/i,
      /what('?s|\s+is)\s+(happening|going\s+on)/i,
      /clarify/i,
      /can\s+you\s+(explain|describe|tell\s+me)/i,
      /meaning\s+of/i,
    ],
  },
  {
    type: "feature",
    priority: 6,
    patterns: [
      /add\s+(a\s+)?(new\s+)?(feature|functionality|capability)/i,
      /implement\s+(a\s+)?(new\s+)?/i,
      /create\s+(a\s+)?(new\s+)?/i,
      /build\s+(a\s+)?(new\s+)?/i,
      /write\s+(a\s+)?(new\s+)?/i,
      /make\s+(a\s+)?(new\s+)?/i,
      /generate\s+(a\s+)?/i,
      /set\s+up\s+(a\s+)?/i,
      /add\s+(support\s+for|handling\s+for)/i,
      /enable\s+(the\s+)?/i,
    ],
  },
];

// Sort by priority (descending)
TASK_PATTERNS.sort((a, b) => b.priority - a.priority);

// ─── Classification ───────────────────────────────────────────────────────────

/**
 * Classify a user prompt into a task type.
 * Returns "general" if no specific pattern matches.
 */
export function classifyTask(prompt: string): TaskType {
  const normalizedPrompt = prompt.trim();

  for (const { type, patterns } of TASK_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(normalizedPrompt)) {
        return type;
      }
    }
  }

  return "general";
}

/**
 * Get a human-readable label for a task type.
 */
export function getTaskTypeLabel(taskType: TaskType): string {
  switch (taskType) {
    case "code-suggest":
      return "Code Suggestions";
    case "code-review":
      return "Code Review";
    case "bug-fix":
      return "Bug Fix";
    case "refactor":
      return "Refactoring";
    case "explain":
      return "Explanation";
    case "feature":
      return "Feature Implementation";
    case "general":
    default:
      return "General Task";
  }
}

/**
 * Get a status message for starting a task.
 */
export function getTaskStartMessage(taskType: TaskType): string {
  switch (taskType) {
    case "code-suggest":
      return "Analyzing code for improvement opportunities...";
    case "code-review":
      return "Reviewing code for issues and best practices...";
    case "bug-fix":
      return "Diagnosing the issue and preparing a fix...";
    case "refactor":
      return "Planning code restructuring...";
    case "explain":
      return "Analyzing code to provide explanation...";
    case "feature":
      return "Planning feature implementation...";
    case "general":
    default:
      return "Processing your request...";
  }
}

// ─── Flow Configuration ───────────────────────────────────────────────────────

export interface TaskFlowConfig {
  /** Whether to run preflight workspace scan */
  preflightScan: boolean;
  /** Whether to show files panel prominently */
  emphasizeFiles: boolean;
  /** Whether to show thinking panel */
  showThinking: boolean;
  /** Whether diffs are expected */
  expectDiffs: boolean;
  /** Whether commands are expected */
  expectCommands: boolean;
  /** Suggested file extensions to prioritize in scanning */
  priorityExtensions: string[];
}

const DEFAULT_FLOW_CONFIG: TaskFlowConfig = {
  preflightScan: true,
  emphasizeFiles: true,
  showThinking: true,
  expectDiffs: false,
  expectCommands: false,
  priorityExtensions: [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java"],
};

const TASK_FLOW_CONFIGS: Record<TaskType, Partial<TaskFlowConfig>> = {
  "code-suggest": {
    preflightScan: true,
    emphasizeFiles: true,
    showThinking: true,
    expectDiffs: true,
  },
  "code-review": {
    preflightScan: true,
    emphasizeFiles: true,
    showThinking: true,
    expectDiffs: false,
  },
  "bug-fix": {
    preflightScan: true,
    emphasizeFiles: true,
    showThinking: true,
    expectDiffs: true,
    expectCommands: true,
  },
  refactor: {
    preflightScan: true,
    emphasizeFiles: true,
    showThinking: true,
    expectDiffs: true,
  },
  explain: {
    preflightScan: true,
    emphasizeFiles: true,
    showThinking: false,
    expectDiffs: false,
  },
  feature: {
    preflightScan: true,
    emphasizeFiles: true,
    showThinking: true,
    expectDiffs: true,
    expectCommands: true,
  },
  general: {
    preflightScan: false,
    emphasizeFiles: false,
    showThinking: true,
    expectDiffs: false,
  },
};

/**
 * Get the flow configuration for a task type.
 */
export function getTaskFlowConfig(taskType: TaskType): TaskFlowConfig {
  const overrides = TASK_FLOW_CONFIGS[taskType] ?? {};
  return { ...DEFAULT_FLOW_CONFIG, ...overrides };
}

// ─── Keyword Extraction ───────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a", "an", "the", "this", "that", "these", "those",
  "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "done",
  "will", "would", "could", "should", "may", "might",
  "can", "cannot", "must", "shall",
  "i", "me", "my", "we", "our", "you", "your",
  "it", "its", "they", "them", "their",
  "what", "which", "who", "whom", "how", "why", "when", "where",
  "and", "or", "but", "if", "then", "else", "so", "because",
  "for", "to", "from", "in", "on", "at", "by", "with", "of",
  "as", "into", "through", "during", "before", "after",
  "up", "down", "out", "off", "over", "under", "again",
  "further", "once", "here", "there", "all", "each", "few",
  "more", "most", "other", "some", "such", "no", "nor", "not",
  "only", "own", "same", "than", "too", "very",
  "just", "now", "also", "like", "please", "help", "need",
  "want", "make", "get", "let", "put", "see", "look", "find",
  "give", "tell", "ask", "use", "try", "work", "seem", "feel",
  "take", "come", "go", "know", "think", "say", "show",
]);

/**
 * Extract meaningful keywords from a prompt.
 * Used for file relevance scoring.
 */
export function extractKeywords(prompt: string): string[] {
  // Tokenize: split on non-word characters, convert to lowercase
  const tokens = prompt
    .toLowerCase()
    .split(/[^a-zA-Z0-9_]+/)
    .filter((token) => token.length > 2);

  // Filter out stop words and dedupe
  const keywords = new Set<string>();
  for (const token of tokens) {
    if (!STOP_WORDS.has(token)) {
      keywords.add(token);
    }
  }

  return Array.from(keywords);
}

/**
 * Extract file paths or patterns mentioned in a prompt.
 */
export function extractFileMentions(prompt: string): string[] {
  const mentions: string[] = [];

  // Match quoted strings that look like paths
  const quotedPaths = prompt.matchAll(/["']([^"']+\.[a-zA-Z0-9]+)["']/g);
  for (const match of quotedPaths) {
    if (match[1]) mentions.push(match[1]);
  }

  // Match unquoted paths (must contain / or \ and extension)
  const unquotedPaths = prompt.matchAll(/\b([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)\b/g);
  for (const match of unquotedPaths) {
    if (match[1] && (match[1].includes("/") || match[1].includes("\\"))) {
      mentions.push(match[1]);
    }
  }

  return [...new Set(mentions)];
}
