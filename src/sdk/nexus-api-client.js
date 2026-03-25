// @ts-check

/**
 * @param {unknown} value
 */
function ensureRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {string} baseUrl
 * @param {string} pathname
 */
function resolveUrl(baseUrl, pathname) {
  return new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

/**
 * @param {Record<string, string | number | boolean | undefined>} query
 */
function toQueryString(query) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    params.set(key, String(value));
  }

  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

/**
 * @typedef {{
 *   baseUrl: string,
 *   apiKey?: string,
 *   token?: string,
 *   headers?: Record<string, string>,
 *   fetchFn?: typeof fetch
 * }} NexusApiClientOptions
 */

/**
 * NEXUS:10 — lightweight SDK client for the NEXUS API.
 */
export class NexusApiClient {
  /**
   * @param {NexusApiClientOptions} options
   */
  constructor(options) {
    if (!options?.baseUrl?.trim()) {
      throw new Error("baseUrl is required.");
    }

    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey?.trim() || "";
    this.token = options.token?.trim() || "";
    this.defaultHeaders = options.headers ?? {};
    this.fetchFn = options.fetchFn ?? fetch;
  }

  /**
   * @param {string} pathname
   * @param {{
   *   method?: string,
   *   body?: unknown,
   *   headers?: Record<string, string>,
   *   query?: Record<string, string | number | boolean | undefined>
   * }} [options]
   */
  async request(pathname, options = {}) {
    const query = toQueryString(options.query ?? {});
    const url = resolveUrl(this.baseUrl, `${pathname}${query}`);
    const headers = new Headers({
      ...this.defaultHeaders,
      ...(options.headers ?? {})
    });

    if (this.apiKey && !headers.has("x-api-key")) {
      headers.set("x-api-key", this.apiKey);
    }

    if (this.token && !headers.has("authorization")) {
      headers.set("authorization", `Bearer ${this.token}`);
    }

    const hasBody = options.body !== undefined;
    const body = hasBody ? JSON.stringify(options.body) : undefined;

    if (hasBody && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await this.fetchFn(url, {
      method: options.method ?? "GET",
      headers,
      body
    });

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const errorPayload = typeof payload === "string" ? { message: payload } : ensureRecord(payload);
      const error = new Error(
        `NEXUS API request failed (${response.status} ${response.statusText})`
      );
      throw Object.assign(error, {
        status: response.status,
        payload: errorPayload
      });
    }

    return payload;
  }

  async health() {
    return this.request("/api/health");
  }

  async getOpenApiSpec() {
    return this.request("/api/openapi.json");
  }

  async syncStatus() {
    return this.request("/api/sync/status");
  }

  async syncNow() {
    return this.request("/api/sync", {
      method: "POST"
    });
  }

  /**
   * @param {{ output: string, guard?: object, compliance?: object }} input
   */
  async guardOutput(input) {
    return this.request("/api/guard/output", {
      method: "POST",
      body: input
    });
  }

  /**
   * @param {{ input?: unknown, pipeline?: unknown }} input
   */
  async runPipeline(input) {
    return this.request("/api/pipeline/run", {
      method: "POST",
      body: input
    });
  }

  /**
   * @param {Record<string, unknown>} input
   */
  async ask(input) {
    return this.request("/api/ask", {
      method: "POST",
      body: input
    });
  }

  /**
   * @param {{ topCommands?: number }} [query]
   */
  async observabilityDashboard(query = {}) {
    return this.request("/api/observability/dashboard", {
      query
    });
  }

  /**
   * @param {string} promptKey
   */
  async listPromptVersions(promptKey) {
    return this.request("/api/versioning/prompts", {
      query: {
        promptKey
      }
    });
  }

  /**
   * @param {{ promptKey: string, content: string, metadata?: Record<string, unknown> }} input
   */
  async savePromptVersion(input) {
    return this.request("/api/versioning/prompts", {
      method: "POST",
      body: input
    });
  }

  /**
   * @param {{ leftId: string, rightId: string }} input
   */
  async comparePromptVersions(input) {
    return this.request("/api/versioning/compare", {
      query: input
    });
  }
}

/**
 * @param {NexusApiClientOptions} options
 */
export function createNexusApiClient(options) {
  return new NexusApiClient(options);
}