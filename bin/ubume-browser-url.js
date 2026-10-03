export class BrowserToolError extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
function fail(code, message) {
  throw new BrowserToolError(code, message);
}
export function isLoopbackUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "localhost" || host === "[::1]" || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host);
  } catch {
    return false;
  }
}
export function browserUrl(value, networkAccess) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return fail("BROWSER_INVALID_URL", "Provide an absolute HTTP(S) URL, for example http://localhost:3000.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    fail("BROWSER_INVALID_URL", "Only HTTP(S) URLs without embedded credentials are accepted.");
  if (!networkAccess && !isLoopbackUrl(url.href))
    fail("BROWSER_NETWORK_DENIED", "External browser access is disabled. Enable Ubume network access; localhost remains available.");
  return url.href;
}
