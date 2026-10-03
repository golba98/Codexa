import assert from "node:assert/strict";
import { createServer } from "node:http";

export const fixtureHtml = `<!doctype html><html><head><title>Ubume browser fixture</title></head><body>
<h1>Browser fixture</h1><a href="/second">Second page</a><button onclick="document.querySelector('#result').textContent='Clicked'">Click me</button>
<form onsubmit="event.preventDefault();document.querySelector('#result').textContent='Submitted '+document.querySelector('#email').value">
<label for="email">Email</label><input id="email" aria-label="Email"><label for="password">Password</label><input id="password" type="password" aria-label="Password">
<label for="notes">Notes</label><textarea id="notes">private initial text</textarea>
<label for="choice">Choice</label><select id="choice"><option value="one">One</option><option value="two">Two</option></select>
<label><input type="checkbox">Remember me</label><button type="submit">Submit</button></form>
<div contenteditable="true" role="textbox" aria-label="Editor">private editable text</div>
<button onclick="this.replaceWith(Object.assign(document.createElement('button'),{textContent:'Replacement'}))">Replace me</button>
<button>Duplicate</button><button>Duplicate</button><div role="dialog" aria-label="Dialog">Dialog text</div>
<p id="result">Ready</p><div style="display:none">Hidden secret</div><div style="height:1800px"></div><p>Bottom content</p>
</body></html>`;

export async function fixtureServer() {
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { Location: "/" });
      response.end();
      return;
    }
    if (request.url === "/external") {
      response.writeHead(302, { Location: "https://example.invalid/" });
      response.end();
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(
      request.url === "/second"
        ? "<html><head><title>Second</title></head><body><h1>Second page</h1></body></html>"
        : fixtureHtml,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
