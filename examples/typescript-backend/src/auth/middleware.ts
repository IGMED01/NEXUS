import { z } from "zod";

import { decodeSessionToken, readBearerToken } from "./jwt";
import type {
  HttpResponse,
  NextHandler,
  RequestContext,
  SessionRecord
} from "../http/types";

const sessionSchema = z.object({
  sessionId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(["user", "admin"]),
  expiresAt: z.string().datetime()
});

export interface AuthRepository {
  findSession(sessionId: string): Promise<SessionRecord | null>;
}

export interface AuthClock {
  now(): Date;
}

export interface AuthMiddlewareDependencies {
  repository: AuthRepository;
  clock: AuthClock;
}

function unauthorized(message: string): HttpResponse {
  return {
    status: 401,
    body: {
      error: "unauthorized",
      message
    }
  };
}

export function createAuthMiddleware(dependencies: AuthMiddlewareDependencies) {
  return async function authMiddleware(
    request: RequestContext["request"],
    next: NextHandler
  ): Promise<HttpResponse> {
    const token = readBearerToken(request.headers.authorization);

    if (!token) {
      return unauthorized("Missing or invalid bearer token.");
    }

    const payload = decodeSessionToken(token);

    if (!payload) {
      return unauthorized("Malformed session token.");
    }

    const session = await dependencies.repository.findSession(payload.sessionId);

    if (!session) {
      return unauthorized("Unknown session.");
    }

    const parsedSession = sessionSchema.safeParse(session);

    if (!parsedSession.success) {
      return unauthorized("Stored session is invalid.");
    }

    const expiresAt = new Date(parsedSession.data.expiresAt);

    if (expiresAt.getTime() <= dependencies.clock.now().getTime()) {
      return unauthorized("Session expired.");
    }

    return next({
      request,
      auth: {
        sessionId: parsedSession.data.sessionId,
        userId: parsedSession.data.userId,
        role: parsedSession.data.role
      }
    });
  };
}
