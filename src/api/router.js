// @ts-check

/**
 * @typedef {import("../types/core-contracts.d.ts").ApiRequest} ApiRequest
 * @typedef {import("../types/core-contracts.d.ts").ApiResponse} ApiResponse
 * @typedef {import("../types/core-contracts.d.ts").ApiRoute} ApiRoute
 * @typedef {(req: ApiRequest, next: () => Promise<ApiResponse>) => Promise<ApiResponse>} Middleware
 * @typedef {{ corsOrigin: string }} RouterConfig
 */

/** @type {ApiRoute[]} */
const routes = [];

/** @type {Middleware[]} */
const middlewares = [];

/**
 * @param {"GET" | "POST"} method
 * @param {string} path
 * @param {ApiRoute["handler"]} handler
 */
export function registerRoute(method, path, handler) {
  routes.push({ method, path, handler });
}

/**
 * @param {Middleware} mw
 */
export function registerMiddleware(mw) {
  middlewares.push(mw);
}

/**
 * @returns {ApiRoute[]}
 */
export function getRegisteredRoutes() {
  return [...routes];
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<Record<string, unknown>>}
 */
export async function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    req.on("data", (/** @type {Buffer} */ chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();

      if (!raw) {
        resolve({});
        return;
      }

      try {
        const parsed = JSON.parse(raw);

        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          resolve(parsed);
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

/**
 * @param {import("node:http").IncomingMessage} httpReq
 * @param {Record<string, unknown>} body
 * @returns {ApiRequest}
 */
export function buildApiRequest(httpReq, body) {
  /** @type {Record<string, string>} */
  const headers = {};
  /** @type {Record<string, string>} */
  const query = {};
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

/**
 * @param {string} method
 * @param {string} path
 * @returns {ApiRoute | undefined}
 */
export function matchRoute(method, path) {
  return routes.find((r) => r.method === method && r.path === path);
}

/**
 * @param {ApiRoute["handler"]} handler
 * @returns {(req: ApiRequest) => Promise<ApiResponse>}
 */
function buildMiddlewareChain(handler) {
  if (middlewares.length === 0) {
    return handler;
  }

  return (/** @type {ApiRequest} */ req) => {
    let index = 0;

    /** @returns {Promise<ApiResponse>} */
    const next = () => {
      if (index < middlewares.length) {
        const mw = middlewares[index++];
        return mw(req, next);
      }

      return handler(req);
    };

    return next();
  };
}

/**
 * @param {number} status
 * @param {Record<string, unknown>} body
 * @returns {ApiResponse}
 */
export function jsonResponse(status, body) {
  return { status, body };
}

/**
 * @param {number} status
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {ApiResponse}
 */
export function errorResponse(status, message, details) {
  return {
    status,
    body: {
      error: true,
      message,
      ...details
    }
  };
}

/**
 * @param {string} origin
 * @returns {Record<string, string>}
 */
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
}

/**
 * @param {import("node:http").IncomingMessage} httpReq
 * @param {import("node:http").ServerResponse} httpRes
 * @param {RouterConfig} config
 */
export async function handleRequest(httpReq, httpRes, config) {
  const startMs = Date.now();

  if (httpReq.method === "OPTIONS") {
    httpRes.writeHead(204, {
      "Content-Type": "application/json",
      ...corsHeaders(config.corsOrigin)
    });
    httpRes.end();
    return;
  }

  /** @type {ApiResponse} */
  let apiResponse;

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

  const responseHeaders = {
    "Content-Type": "application/json",
    "X-Response-Time": `${Date.now() - startMs}ms`,
    ...corsHeaders(config.corsOrigin),
    ...(apiResponse.headers ?? {})
  };

  const payload = JSON.stringify(apiResponse.body, null, 2);
  httpRes.writeHead(apiResponse.status, responseHeaders);
  httpRes.end(payload);
}
