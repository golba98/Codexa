import { APP_VERSION } from "../config/settings.js";

export const CODEXA_CHANNEL_ENV = "CODEXA_CHANNEL";
export const LOCAL_DEV_CHANNEL = "local-dev";

export function getCodexaChannel(env: NodeJS.ProcessEnv = process.env): string {
  return env[CODEXA_CHANNEL_ENV]?.trim() || "published";
}

export function isLocalDevChannel(env: NodeJS.ProcessEnv = process.env): boolean {
  return getCodexaChannel(env) === LOCAL_DEV_CHANNEL;
}

export function formatCodexaVersionLabel(
  version: string = APP_VERSION,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return isLocalDevChannel(env) ? `${version}-dev local` : version;
}

export function formatCodexaBrandLabel(env: NodeJS.ProcessEnv = process.env): string {
  return `Codexa v${formatCodexaVersionLabel(APP_VERSION, env)}`;
}
