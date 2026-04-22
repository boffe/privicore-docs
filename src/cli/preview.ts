/**
 * Serve dist/ on a local port for manual preview. Uses Node's built-in
 * http module — no extra dependencies.
 *
 * Usage:
 *   npm run preview
 *   npm run preview -- --port 4000 --dir dist-staging
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";

interface Args { dir: string; port: number; }

function parseArgs(argv: string[]): Args {
  const out: Args = { dir: "dist", port: 4173 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") out.dir = argv[++i]!;
    else if (a === "--port") out.port = parseInt(argv[++i]!, 10);
  }
  return out;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.dir);
  if (!fs.existsSync(root)) {
    console.error(`dir not found: ${root}. Run \`npm run build\` first.`);
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]!);
      let filePath = path.join(root, urlPath);
      // Prevent directory escape.
      if (!filePath.startsWith(root)) {
        res.writeHead(400); res.end("bad path"); return;
      }
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }
      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end(`404 ${urlPath}`);
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`500 ${(e as Error).message}`);
    }
  });

  server.listen(args.port, () => {
    console.log(`preview serving ${root} at http://localhost:${args.port}/`);
    console.log("ctrl-c to stop.");
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
