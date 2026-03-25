// @ts-check

/**
 * @param {unknown} value
 */
function asNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/**
 * NEXUS:10 — OpenAPI 3.1 spec for the public API surface.
 * @param {{
 *   title?: string,
 *   version?: string,
 *   description?: string,
 *   serverUrl?: string
 * }} [options]
 */
export function buildNexusOpenApiSpec(options = {}) {
  const title = asNonEmptyString(options.title) || "NEXUS API";
  const version = asNonEmptyString(options.version) || "1.0.0";
  const description =
    asNonEmptyString(options.description) ||
    "NEXUS interface for sync, guard, orchestration, ask, observability, and prompt versioning.";
  const serverUrl = asNonEmptyString(options.serverUrl) || "http://127.0.0.1:8787";

  return {
    openapi: "3.1.0",
    info: {
      title,
      version,
      description
    },
    servers: [
      {
        url: serverUrl
      }
    ],
    security: [
      {
        ApiKeyAuth: []
      },
      {
        BearerAuth: []
      }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "x-api-key"
        },
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT"
        }
      },
      schemas: {
        ApiStatus: {
          type: "object",
          additionalProperties: true,
          properties: {
            status: {
              type: "string"
            }
          }
        },
        AskRequest: {
          type: "object",
          required: ["question"],
          additionalProperties: true,
          properties: {
            question: { type: "string" },
            task: { type: "string" },
            objective: { type: "string" },
            language: {
              type: "string",
              enum: ["es", "en"]
            },
            provider: { type: "string" },
            fallbackProviders: {
              type: "array",
              items: {
                type: "string"
              }
            },
            attemptTimeoutMs: { type: "integer", minimum: 0 },
            model: { type: "string" },
            tokenBudget: { type: "integer" },
            maxChunks: { type: "integer" },
            guardPolicyProfile: { type: "string" }
          }
        },
        GuardRequest: {
          type: "object",
          required: ["output"],
          additionalProperties: true,
          properties: {
            output: { type: "string" },
            guardPolicyProfile: { type: "string" },
            guard: { type: "object", additionalProperties: true },
            compliance: { type: "object", additionalProperties: true }
          }
        },
        SavePromptVersionRequest: {
          type: "object",
          required: ["promptKey", "content"],
          additionalProperties: true,
          properties: {
            promptKey: { type: "string" },
            content: { type: "string" },
            metadata: { type: "object", additionalProperties: true }
          }
        }
      }
    },
    paths: {
      "/api/health": {
        get: {
          summary: "Health check",
          security: [],
          responses: {
            "200": {
              description: "Service status",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ApiStatus"
                  }
                }
              }
            }
          }
        }
      },
      "/api/openapi.json": {
        get: {
          summary: "OpenAPI specification",
          security: [],
          responses: {
            "200": {
              description: "Current API spec"
            }
          }
        }
      },
      "/api/demo": {
        get: {
          summary: "Interactive demo UI",
          security: [],
          responses: {
            "200": {
              description: "HTML dashboard + API playground"
            }
          }
        }
      },
      "/api/sync/status": {
        get: {
          summary: "Sync scheduler and last sync status",
          responses: {
            "200": { description: "Status response" }
          }
        }
      },
      "/api/sync/drift": {
        get: {
          summary: "Sync drift report across runs",
          parameters: [
            {
              name: "warningRatio",
              in: "query",
              required: false,
              schema: { type: "number", minimum: 0, maximum: 1 }
            },
            {
              name: "criticalRatio",
              in: "query",
              required: false,
              schema: { type: "number", minimum: 0, maximum: 1 }
            },
            {
              name: "spikeMultiplier",
              in: "query",
              required: false,
              schema: { type: "number", minimum: 0 }
            },
            {
              name: "baselineWindow",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1 }
            }
          ],
          responses: {
            "200": { description: "Drift report" }
          }
        }
      },
      "/api/sync": {
        post: {
          summary: "Run sync now",
          responses: {
            "200": { description: "Sync started and completed" }
          }
        }
      },
      "/api/guard/output": {
        post: {
          summary: "Run output guard and compliance checks",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/GuardRequest"
                }
              }
            }
          },
          responses: {
            "200": { description: "Output accepted" },
            "422": { description: "Output blocked" }
          }
        }
      },
      "/api/guard/policies": {
        get: {
          summary: "List available guard policy profiles",
          security: [],
          responses: {
            "200": { description: "Guard profiles list" }
          }
        }
      },
      "/api/pipeline/run": {
        post: {
          summary: "Execute orchestration pipeline",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: true
                }
              }
            }
          },
          responses: {
            "200": { description: "Pipeline result" }
          }
        }
      },
      "/api/ask": {
        post: {
          summary: "Generate LLM answer with NEXUS context",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AskRequest"
                }
              }
            }
          },
          responses: {
            "200": { description: "Answer generated" },
            "422": { description: "Guard/compliance blocked" }
          }
        }
      },
      "/api/observability/dashboard": {
        get: {
          summary: "Dashboard-ready observability payload",
          parameters: [
            {
              name: "topCommands",
              in: "query",
              required: false,
              schema: {
                type: "integer",
                minimum: 1
              }
            }
          ],
          responses: {
            "200": { description: "Dashboard payload" }
          }
        }
      },
      "/api/observability/alerts": {
        get: {
          summary: "Alert status derived from observability metrics",
          parameters: [
            {
              name: "blockedRateMax",
              in: "query",
              required: false,
              schema: { type: "number" }
            },
            {
              name: "degradedRateMax",
              in: "query",
              required: false,
              schema: { type: "number" }
            },
            {
              name: "recallHitRateMin",
              in: "query",
              required: false,
              schema: { type: "number" }
            },
            {
              name: "averageDurationMsMax",
              in: "query",
              required: false,
              schema: { type: "number" }
            },
            {
              name: "minRuns",
              in: "query",
              required: false,
              schema: { type: "integer" }
            }
          ],
          responses: {
            "200": { description: "Alert report" }
          }
        }
      },
      "/api/versioning/prompts": {
        get: {
          summary: "List prompt versions by key",
          parameters: [
            {
              name: "promptKey",
              in: "query",
              required: true,
              schema: {
                type: "string"
              }
            }
          ],
          responses: {
            "200": { description: "Prompt versions list" }
          }
        },
        post: {
          summary: "Save a prompt version",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SavePromptVersionRequest"
                }
              }
            }
          },
          responses: {
            "200": { description: "Version saved" }
          }
        }
      },
      "/api/versioning/compare": {
        get: {
          summary: "Diff two prompt versions",
          parameters: [
            {
              name: "leftId",
              in: "query",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "rightId",
              in: "query",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": { description: "Prompt diff payload" }
          }
        }
      },
      "/api/versioning/rollback-plan": {
        post: {
          summary: "Build rollback plan from policy + eval scores",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["promptKey"],
                  properties: {
                    promptKey: { type: "string" },
                    minScore: { type: "number" },
                    preferPrevious: { type: "boolean" },
                    evalScoresByVersion: {
                      type: "object",
                      additionalProperties: {
                        type: "number"
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": { description: "Rollback plan response" }
          }
        }
      }
    }
  };
}
