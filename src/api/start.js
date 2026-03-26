#!/usr/bin/env node
// @ts-check
/**
 * Production entry point — serves API + static UI from ui/dist.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Import handlers to register all routes
import "./handlers.js";
import { handleRequest } from "./router.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIST = path.resolve(__dirname, "../../ui/dist");

const MIME_TYPES = {
  ".html": "text/html",
  ".css":  "text/css",
  ".js":   "application/javascript",
  ".json": "application/json",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".ttf":  "font/ttf",
  ".map":  "application/json",
};

/**
 * Try to serve a static file from ui/dist.
 * @param {string} urlPath
 * @param {http.ServerResponse} res
 * @returns {boolean}
 */
function tryServeStatic(urlPath, res) {
  // Prevent directory traversal
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(UI_DIST, safePath);

  if (!filePath.startsWith(UI_DIST)) return false;

  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    const content = fs.readFileSync(filePath);

    res.writeHead(200, {
      "Content-Type": mime,
      "Content-Length": content.length,
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Serve index.html for SPA routing.
 * @param {http.ServerResponse} res
 */
function serveSpaFallback(res) {
  const indexPath = path.join(UI_DIST, "index.html");
  try {
    const content = fs.readFileSync(indexPath, "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("UI not built. Run: cd ui && npm run build");
  }
}

const host = process.env.LCS_API_HOST || "0.0.0.0";
const port = Number(process.env.LCS_API_PORT || 3100);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  // API routes → router.js (handlers.js registered routes)
  if (pathname.startsWith("/api/")) {
    await handleRequest(req, res, { corsOrigin: "*" });
    return;
  }

  // Static files from ui/dist
  if (tryServeStatic(pathname, res)) return;

  // SPA fallback — serve index.html for client-side routing
  serveSpaFallback(res);
});

server.listen(port, host, () => {
  console.log(`NEXUS production server listening on http://${host}:${port}`);
  console.log(`  API:  http://${host}:${port}/api/health`);
  console.log(`  UI:   http://${host}:${port}/`);
});

const shutdown = () => {
  console.log("Shutting down...");
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
