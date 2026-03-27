/**
 * Zero-dependency HTTP router for the LCS API.
 *
 * Uses native `node:http` — no Express, no Fastify, no frameworks.
 * This keeps the dependency tree clean and the server lightweight.
 *
 * Architecture:
 *   IncomingMessage → parseRequest() → matchRoute() → handler() → sendResponse()
 *                                          ↓
 *                                     middleware[]  (guard, CORS, etc.)
 *
 * Design decisions:
 * - Routes are registered as { method, path, handler } tuples
 * - Middleware runs before the handler (guard evaluation, auth, etc.)
 * - All handlers receive a typed ApiRequest and return ApiResponse
 * - JSON-in, JSON-out — no HTML, no templates
 * - Errors are caught and returned as structured JSON
 */

import type {
  ApiRequest,
  ApiResponse,
  ApiRoute,
  ApiServerConfig
} from "../types/core-contracts.d.ts";

// ── Types ────────────────────────────────────────────────────────────

export type Middleware = (req: ApiRequest, next: () => Promise<ApiResponse>) => Promise<ApiResponse>;

export interface RouterConfig {
  corsOrigin: string;
}

// ── Route Registry ───────────────────────────────────────────────────

const routes: ApiRoute[] = [];
const middlewares: Middleware[] = [];

export function registerRoute(method: "GET" | "POST", path: string, handler: ApiRoute["handler"]): void {
  routes.push({ method, path, handler });
}

export function registerMiddleware(mw: Middleware): void {
  middlewares.push(mw);
}

export function getRegisteredRoutes(): ApiRoute[] {
  return [...routes];
}

// ── Request Parsing ──────────────────────────────────────────────────

export async function parseRequestBody(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();

      if (!raw) {
        resolve({});
        return;
      }

      try {
        const parsed = JSON.parse(raw);

        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          resolve(parsed as Record<string, unknown>);
        } else {
          reject(new Error("Request body must be a JSON object."));
        }
      } catch {
        reject(new Error("Invalid JSON in request body."));
      }
    });
    req.on("error", reject);
  });
}

export function buildApiRequest(
  httpReq: import("node:http").IncomingMessage,
  body: Record<string, unknown>
): ApiRequest {
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  const requestUrl = new URL(httpReq.url ?? "/", "http://127.0.0.1");

  for (const [key, value] of Object.entries(httpReq.headers)) {
    if (typeof value === "string") {
      headers[key] = value;
    }
  }

  requestUrl.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  return {
    method: (httpReq.method ?? "GET").toUpperCase(),
    path: requestUrl.pathname,
    body,
    headers,
    query
  };
}

// ── Route Matching ───────────────────────────────────────────────────

export function matchRoute(method: string, path: string): ApiRoute | undefined {
  return routes.find((r) => r.method === method && r.path === path);
}

// ── Middleware Chain ──────────────────────────────────────────────────

function buildMiddlewareChain(handler: ApiRoute["handler"]): (req: ApiRequest) => Promise<ApiResponse> {
  if (middlewares.length === 0) {
    return handler;
  }

  return (req: ApiRequest) => {
    let index = 0;

    const next = (): Promise<ApiResponse> => {
      if (index < middlewares.length) {
        const mw = middlewares[index++];
        return mw(req, next);
      }

      return handler(req);
    };

    return next();
  };
}

// ── Response Helpers ─────────────────────────────────────────────────

export function jsonResponse(status: number, body: Record<string, unknown>): ApiResponse {
  return { status, body };
}

export function errorResponse(status: number, message: string, details?: Record<string, unknown>): ApiResponse {
  return {
    status,
    body: {
      error: true,
      message,
      ...details
    }
  };
}

// ── CORS Headers ─────────────────────────────────────────────────────

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
}

// ── Main Request Handler ─────────────────────────────────────────────

export async function handleRequest(
  httpReq: import("node:http").IncomingMessage,
  httpRes: import("node:http").ServerResponse,
  config: RouterConfig
): Promise<void> {
  const startMs = Date.now();

  // CORS preflight
  if (httpReq.method === "OPTIONS") {
    httpRes.writeHead(204, {
      "Content-Type": "application/json",
      ...corsHeaders(config.corsOrigin)
    });
    httpRes.end();
    return;
  }

  let apiResponse: ApiResponse;

  try {
    const body = httpReq.method === "POST"
      ? await parseRequestBody(httpReq)
      : {};

    const apiReq = buildApiRequest(httpReq, body);
    const route = matchRoute(apiReq.method, apiReq.path);

    if (!route) {
      apiResponse = errorResponse(404, `No route matches ${apiReq.method} ${apiReq.path}`);
    } else {
      const chainedHandler = buildMiddlewareChain(route.handler);
      apiResponse = await chainedHandler(apiReq);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    apiResponse = errorResponse(500, message);
  }

  const responseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Response-Time": `${Date.now() - startMs}ms`,
    ...corsHeaders(config.corsOrigin),
    ...(apiResponse.headers ?? {})
  };

  const payload = JSON.stringify(apiResponse.body, null, 2);
  httpRes.writeHead(apiResponse.status, responseHeaders);
  httpRes.end(payload);
}
