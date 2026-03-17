import { describe, expect, it, vi } from "vitest";

import { createAuthMiddleware } from "../../src/auth/middleware";
import { getProfile } from "../../src/routes/profile";

describe("auth middleware", () => {
  it("rejects expired sessions before the route handler runs", async () => {
    const repository = {
      findSession: vi.fn().mockResolvedValue({
        sessionId: "expired-1",
        userId: "user-7",
        role: "user",
        expiresAt: "2026-03-01T10:00:00.000Z"
      })
    };
    const clock = {
      now: () => new Date("2026-03-17T10:00:00.000Z")
    };
    const routeSpy = vi.fn(getProfile);
    const middleware = createAuthMiddleware({ repository, clock });

    const response = await middleware(
      {
        headers: {
          authorization: "Bearer session:expired-1"
        },
        params: {}
      },
      routeSpy
    );

    expect(response.status).toBe(401);
    expect(routeSpy).not.toHaveBeenCalled();
  });

  it("attaches auth context and reaches the route handler for valid sessions", async () => {
    const repository = {
      findSession: vi.fn().mockResolvedValue({
        sessionId: "active-1",
        userId: "user-9",
        role: "admin",
        expiresAt: "2026-04-01T10:00:00.000Z"
      })
    };
    const clock = {
      now: () => new Date("2026-03-17T10:00:00.000Z")
    };
    const middleware = createAuthMiddleware({ repository, clock });

    const response = await middleware(
      {
        headers: {
          authorization: "Bearer session:active-1"
        },
        params: {}
      },
      getProfile
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      userId: "user-9",
      role: "admin"
    });
  });
});
