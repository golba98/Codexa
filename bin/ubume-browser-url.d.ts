export class BrowserToolError extends Error { code: string; constructor(code: string, message: string); }
export function browserUrl(value: unknown, networkAccess: boolean): string;
export function isLoopbackUrl(value: string): boolean;
