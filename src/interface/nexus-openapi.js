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
        ErrorResponse: {
          type: "object",
          required: ["status", "error", "errorCode", "requestId"],
          properties: {
            status: { type: "string", enum: ["error"] },
            error: { type: "string" },
            errorCode: { type: "string" },
            requestId: { type: "string" },
            details: { type: "object", additionalProperties: true }
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
            guardPolicyProfile: { type: "string" },
            chunks: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true
              }
            }
          }
        },
        ChatRequest: {
          type: "object",
          required: ["query"],
          additionalProperties: true,
          properties: {
            query: { type: "string" },
            question: { type: "string" },
            task: { type: "string" },
            objective: { type: "string" },
            language: {
              type: "string",
              enum: ["es", "en"]
            },
            withContext: { type: "boolean" },
            provider: { type: "string" },
            fallbackProviders: {
              type: "array",
              items: { type: "string" }
            },
            attemptTimeoutMs: { type: "integer", minimum: 0 },
            model: { type: "string" },
            tokenBudget: { type: "integer" },
            maxChunks: { type: "integer" },
            guardPolicyProfile: { type: "string" },
            chunks: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true
              }
            }
          }
        },
        ContextUsage: {
          type: "object",
          additionalProperties: true,
          properties: {
            chunks: { type: "integer" },
            tokens: { type: "integer" }
          }
        },
        ContextImpact: {
          type: "object",
          additionalProperties: true,
          properties: {
            withoutNexus: { $ref: "#/components/schemas/ContextUsage" },
            withNexus: { $ref: "#/components/schemas/ContextUsage" },
            suppressed: { $ref: "#/components/schemas/ContextUsage" },
            savings: {
              type: "object",
              additionalProperties: true,
              properties: {
                chunks: { type: "integer" },
                tokens: { type: "integer" },
                percent: { type: "number" }
              }
            }
          }
        },
        AskResponse: {
          type: "object",
          additionalProperties: true,
          properties: {
            status: { type: "string" },
            degraded: { type: "boolean" },
            provider: { type: "string" },
            context: {
              type: "object",
              additionalProperties: true
            },
            impact: {
              $ref: "#/components/schemas/ContextImpact"
            }
          }
        },
        ChatResponse: {
          type: "object",
          additionalProperties: true,
          properties: {
            status: { type: "string" },
            response: { type: "string" },
            degraded: { type: "boolean" },
            provider: { type: "string" },
            context: {
              type: "object",
              additionalProperties: true
            },
            impact: {
              $ref: "#/components/schemas/ContextImpact"
            }
          }
        },
        RememberRequest: {
          type: "object",
          required: ["content"],
          additionalProperties: true,
          properties: {
            title: { type: "string" },
            source: { type: "string" },
            content: { type: "string" },
            text: { type: "string" },
            type: { type: "string" },
            kind: { type: "string" }
          }
        },
        RememberResponse: {
          type: "object",
          additionalProperties: true,
          properties: {
            status: { type: "string" },
            id: { type: "string" },
            stored: { type: "integer" },
            chunks: { type: "integer" },
            tokens: { type: "integer" }
          }
        },
        RecallRequest: {
          type: "object",
          required: ["query"],
          additionalProperties: true,
          properties: {
            query: { type: "string" },
            limit: { type: "integer", minimum: 1 }
          }
        },
        RecallResponse: {
          type: "object",
          additionalProperties: true,
          properties: {
            status: { type: "string" },
            query: { type: "string" },
            chunks: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true
              }
            },
            total: { type: "integer" },
            stats: {
              type: "object",
              additionalProperties: true
            }
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
        },
        DomainEvalRequest: {
          type: "object",
          additionalProperties: true,
          properties: {
            suitePath: { type: "string" },
            suite: {
              type: "object",
              additionalProperties: true,
              description: "Optional inline eval suite payload. If omitted, server loads suitePath/default suite."
            }
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
      "/api/routes": {
        get: {
          summary: "List API routes exposed by server",
          security: [],
          responses: {
            "200": { description: "Route list" }
          }
        }
      },
      "/api/metrics": {
        get: {
          summary: "Get observability metrics report",
          security: [],
          responses: {
            "200": { description: "Metrics payload" }
          }
        }
      },
      "/api/remember": {
        post: {
          summary: "Persist knowledge chunk/document into NEXUS memory",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/RememberRequest"
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Persist result",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RememberResponse" }
                }
              }
            },
            "400": {
              description: "Invalid request payload",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            }
          }
        }
      },
      "/api/recall": {
        post: {
          summary: "Recall relevant chunks for a query",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/RecallRequest"
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Recall result",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RecallResponse" }
                }
              }
            },
            "400": {
              description: "Invalid request payload",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            }
          }
        }
      },
      "/api/chat": {
        post: {
          summary: "Ask chat endpoint with optional selected context and impact metrics",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ChatRequest"
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Chat response",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ChatResponse" }
                }
              }
            },
            "400": {
              description: "Invalid request payload",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            },
            "422": { description: "Guard/compliance blocked" }
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
            "200": { description: "Pipeline result" },
            "400": {
              description: "Invalid request payload",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            },
            "500": {
              description: "Internal error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            }
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
            "200": {
              description: "Answer generated",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AskResponse" }
                }
              }
            },
            "400": {
              description: "Invalid request payload",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            },
            "422": {
              description: "Guard/compliance blocked",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AskResponse" }
                }
              }
            },
            "500": {
              description: "Internal error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            }
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
      "/api/evals/domain-suite": {
        post: {
          summary: "Run domain eval suite and return pass/blocked report",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/DomainEvalRequest"
                }
              }
            }
          },
          responses: {
            "200": { description: "Domain eval report" },
            "400": {
              description: "Invalid request payload",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            },
            "500": {
              description: "Internal error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            }
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
