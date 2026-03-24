// @ts-check

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * @param {string} value
 */
function decodeBase64Url(value) {
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = `${normalized}${"=".repeat((4 - (normalized.length % 4 || 4)) % 4)}`;
  return Buffer.from(padded, "base64");
}

/**
 * @param {string} payload
 */
function parseJson(payload) {
  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

/**
 * @param {string} token
 * @param {string} secret
 */
function verifyHs256Token(token, secret) {
  const parts = token.split(".");

  if (parts.length !== 3) {
    return {
      valid: false,
      reason: "malformed-token",
      payload: {}
    };
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const expected = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  const signature = decodeBase64Url(encodedSignature);

  if (
    expected.length !== signature.length ||
    !timingSafeEqual(expected, signature)
  ) {
    return {
      valid: false,
      reason: "invalid-signature",
      payload: {}
    };
  }

  const payloadJson = decodeBase64Url(encodedPayload).toString("utf8");
  const payload = /** @type {Record<string, unknown>} */ (parseJson(payloadJson));

  if (typeof payload.exp === "number" && Date.now() >= payload.exp * 1000) {
    return {
      valid: false,
      reason: "token-expired",
      payload
    };
  }

  return {
    valid: true,
    reason: "",
    payload
  };
}

/**
 * @param {Record<string, string | string[] | undefined>} headers
 * @param {string} key
 */
function readHeader(headers, key) {
  const value = headers[key.toLowerCase()] ?? headers[key];

  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return typeof value === "string" ? value : "";
}

/**
 * NEXUS:10 — API key / JWT authentication middleware.
 * @param {{ apiKeys?: string[], jwtSecret?: string, requireAuth?: boolean }} [options]
 */
export function createAuthMiddleware(options = {}) {
  const apiKeys = new Set(
    (options.apiKeys ?? [])
      .map((entry) => String(entry).trim())
      .filter(Boolean)
  );
  const jwtSecret = String(options.jwtSecret ?? "").trim();
  const requireAuth = options.requireAuth !== false;

  return {
    /**
     * @param {{ headers: Record<string, string | string[] | undefined> }} request
     */
    authorize(request) {
      if (!requireAuth) {
        return {
          authorized: true,
          principal: {
            type: "anonymous"
          },
          reason: "auth-disabled"
        };
      }

      const apiKey = readHeader(request.headers, "x-api-key");

      if (apiKey && apiKeys.has(apiKey)) {
        return {
          authorized: true,
          principal: {
            type: "api-key"
          },
          reason: "api-key"
        };
      }

      const authHeader = readHeader(request.headers, "authorization");
      const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/iu);

      if (tokenMatch && jwtSecret) {
        const verified = verifyHs256Token(tokenMatch[1], jwtSecret);

        if (verified.valid) {
          return {
            authorized: true,
            principal: {
              type: "jwt",
              claims: verified.payload
            },
            reason: "jwt"
          };
        }

        return {
          authorized: false,
          statusCode: 401,
          error: `Invalid token (${verified.reason}).`,
          reason: verified.reason
        };
      }

      return {
        authorized: false,
        statusCode: 401,
        error: "Authentication required.",
        reason: "missing-credentials"
      };
    }
  };
}
