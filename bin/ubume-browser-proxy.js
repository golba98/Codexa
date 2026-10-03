import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";

// Chromium routes every HTTP(S)/WebSocket request through this proxy, including
// redirected requests. Playwright routing alone skips some redirect hops.
export async function createBrowserProxy(allowed) {
  const sockets = new Set();
  const server = createServer((request, response) => {
    let url;
    try { url = new URL(request.url); } catch { response.writeHead(400); response.end(); return; }
    if (url.protocol !== "http:" || !allowed(url.href)) { response.writeHead(403); response.end("Browser network access denied."); return; }
    const headers = { ...request.headers };
    delete headers["proxy-authorization"]; delete headers["proxy-connection"];
    const upstream = httpRequest(url, { method: request.method, headers, agent: false }, (result) => {
      response.writeHead(result.statusCode ?? 502, result.headers); result.pipe(response);
    });
    upstream.setTimeout(30000, () => upstream.destroy());
    upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end("Local browser server unavailable."); });
    request.on("aborted", () => upstream.destroy()); response.on("close", () => upstream.destroy());
    request.pipe(upstream);
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  const tunnel = (request, client, head, websocket) => {
    let url;
    try { url = new URL(websocket ? request.url : `http://${request.url}`); } catch { client.destroy(); return; }
    if (!allowed(url.href) || url.username || url.password) { client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
    const upstream = connect(Number(url.port || (websocket ? 80 : 443)), url.hostname.replace(/^\[|\]$/g, ""));
    sockets.add(upstream); upstream.on("close", () => sockets.delete(upstream));
    upstream.setTimeout(30000, () => upstream.destroy());
    upstream.on("error", () => client.destroy()); client.on("error", () => upstream.destroy()); client.on("close", () => upstream.destroy());
    upstream.once("connect", () => {
      if (websocket) {
        const headers = Object.entries(request.headers).filter(([key]) => !key.startsWith("proxy-")).map(([key, value]) => `${key}: ${value}`).join("\r\n");
        upstream.write(`${request.method} ${url.pathname}${url.search} HTTP/1.1\r\n${headers}\r\n\r\n`);
      } else client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      client.pipe(upstream); upstream.pipe(client);
    });
  };
  server.on("connect", (request, socket, head) => tunnel(request, socket, head, false));
  server.on("upgrade", (request, socket, head) => tunnel(request, socket, head, true));
  server.on("clientError", (_error, socket) => socket.destroy());
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); },
  };
}
