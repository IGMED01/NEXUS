import type { HttpResponse, RequestContext } from "../http/types";

export async function getProfile(context: RequestContext): Promise<HttpResponse> {
  if (!context.auth) {
    return {
      status: 500,
      body: {
        error: "missing_auth_context"
      }
    };
  }

  return {
    status: 200,
    body: {
      userId: context.auth.userId,
      role: context.auth.role,
      profileVisibility: context.auth.role === "admin" ? "full" : "restricted"
    }
  };
}
