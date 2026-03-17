export interface TokenPayload {
  sessionId: string;
}

export function readBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const [scheme, token] = header.trim().split(/\s+/u);

  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token;
}

export function decodeSessionToken(token: string): TokenPayload | null {
  const [prefix, sessionId] = token.split(":", 2);

  if (prefix !== "session" || !sessionId) {
    return null;
  }

  return { sessionId };
}
