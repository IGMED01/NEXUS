export interface HttpRequest {
  headers: Record<string, string | undefined>;
  params: Record<string, string | undefined>;
  body?: unknown;
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

export interface SessionRecord {
  sessionId: string;
  userId: string;
  role: "user" | "admin";
  expiresAt: string;
}

export interface AuthContext {
  sessionId: string;
  userId: string;
  role: "user" | "admin";
}

export interface RequestContext {
  request: HttpRequest;
  auth?: AuthContext;
}

export type NextHandler = (context: RequestContext) => Promise<HttpResponse>;
