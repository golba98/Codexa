import type { ComputerUseCapability } from "../src/core/computerUse/capability.js";
import type { ComputerUseBackend, ComputerUsePolicy, ComputerUseRequest, ComputerUseResult } from "../src/core/computerUse/types.js";
export class BrowserToolError extends Error { code: string; constructor(code: string, message: string); }
export function browserUrl(value: unknown, networkAccess: boolean): string;
export function isLoopbackUrl(value: string): boolean;
export class BrowserManager implements ComputerUseBackend {
  constructor(capability: ComputerUseCapability, onProcess?: (pid: number, closed?: boolean) => void);
  execute(request: ComputerUseRequest, policy: ComputerUsePolicy): Promise<ComputerUseResult>;
  approvalState(sessionId: string, args: Record<string, unknown>, typing: boolean, signal: AbortSignal): Promise<{ description: string; identity: string }>;
  closeSession(sessionId: string): Promise<void>;
  shutdown(): Promise<void>;
  terminate(): void;
}
