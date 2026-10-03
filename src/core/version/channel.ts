import { APP_VERSION } from "../../config/settings.js";

export const UBUME_CHANNEL_ENV = "UBUME_CHANNEL";
const CODEXA_CHANNEL_ENV = "CODEXA_CHANNEL";
export const LOCAL_DEV_CHANNEL = "local-dev";

function getUbumeChannel(env: NodeJS.ProcessEnv = process.env): string {
  return env[UBUME_CHANNEL_ENV]?.trim() || env[CODEXA_CHANNEL_ENV]?.trim() || "published";
}

export function isLocalDevChannel(env: NodeJS.ProcessEnv = process.env): boolean {
  return getUbumeChannel(env) === LOCAL_DEV_CHANNEL;
}

export function formatUbumeVersionLabel(
  version: string = APP_VERSION,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return isLocalDevChannel(env) ? `${version}-dev local` : version;
}

export function formatUbumeBrandLabel(env: NodeJS.ProcessEnv = process.env): string {
  return `Ubume v${formatUbumeVersionLabel(APP_VERSION, env)}`;
}
