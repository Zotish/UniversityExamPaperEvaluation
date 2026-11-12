import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { handleApiRequest } from "./app.ts";

const PORT = parseInt(process.env.API_PORT || process.env.PORT || "3001", 10);
const DIST_DIR = path.resolve(process.cwd(), "dist");

const MIME_MAP: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  try {
    const handled = await handleApiRequest(req, res);
    if (handled) return;

    if (fs.existsSync(DIST_DIR)) {
      const reqPath = (req.url || "/").split("?")[0];
      const safeRel = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, "");
      let filePath = path.join(DIST_DIR, safeRel === "/" ? "index.html" : safeRel);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(DIST_DIR, "index.html");
      }
      const ext = path.extname(filePath).toLowerCase();
      res.statusCode = 200;
      res.setHeader("Content-Type", MIME_MAP[ext] || "application/octet-stream");
      res.end(fs.readFileSync(filePath));
      return;
    }

    res.statusCode = 404;
    res.end("Not found");
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Server error" }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`EvalDesk API & server running on http://localhost:${PORT}`);
});

