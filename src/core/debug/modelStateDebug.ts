import { appendFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";

type ModelStateDebugDetails = Record<string, unknown>;

let sequence = 0;

export function isModelStateDebugEnabled(): boolean {
  return process.env.CODEXA_RENDER_DEBUG === "1" || process.env.CODEXA_DEBUG_MODEL_STATE === "1";
}

export function getModelStateDebugLogPath(): string {
  return process.env.CODEXA_RENDER_DEBUG_FILE?.trim()
    || process.env.CODEXA_DEBUG_MODEL_STATE_LOG?.trim()
    || join(process.cwd(), ".codexa", "debug", "render-status.log");
}

export function traceModelStateDebug(event: string, details: ModelStateDebugDetails = {}): void {
  if (!isModelStateDebugEnabled()) return;

  try {
    const entry = {
      ts: new Date().toISOString(),
      seq: ++sequence,
      event,
      ...details,
    };
    const logPath = getModelStateDebugLogPath();
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Debug logging must never affect the TUI.
  }
}
