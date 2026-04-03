import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = 3333;

Bun.serve({
  port,
  fetch(req) {
    const html = readFileSync(join(__dirname, "index.html"), "utf-8");
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  },
});

console.log(`Preview running at http://localhost:${port}`);
