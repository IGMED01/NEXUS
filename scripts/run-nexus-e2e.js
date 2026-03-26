#!/usr/bin/env node
// @ts-check

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createNexusApiServer } from "../src/api/server.js";

/**
 * @param {number} status
 * @param {string} step
 * @param {unknown} detail
 */
function fail(status, step, detail) {
  console.error(
    JSON.stringify(
      {
        status: "error",
        step,
        detail
      },
      null,
      2
    )
  );
  process.exit(status);
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));

  return {
    status: response.status,
    ok: response.ok,
    payload
  };
}

async function main() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-e2e-"));
  const apiKey = "nexus-e2e-key";
  const server = createNexusApiServer({
    host: "127.0.0.1",
    port: 0,
    auth: {
      requireAuth: true,
      apiKeys: [apiKey]
    },
    llm: {
      defaultProvider: "mock",
      providers: [
        {
          provider: "mock",
          async generate() {
            return {
              content: [
                "Change:",
                "Validated auth boundary first.",
                "Reason:",
                "Fail fast before business logic.",
                "Concepts:",
                "- Middleware boundary",
                "- Guardrails",
                "Practice:",
                "Add one failing token test."
              ].join("\n")
            };
          }
        }
      ]
    },
    sync: {
      rootPath: tempRoot,
      autoStart: false
    },
    repositoryFilePath: path.join(tempRoot, "chunks.jsonl")
  });

  let started = false;

  try {
    const start = await server.start();
    started = true;
    const baseUrl = `http://127.0.0.1:${start.port}`;
    const authHeaders = {
      "content-type": "application/json",
      "x-api-key": apiKey
    };

    const remember = await fetchJson(`${baseUrl}/api/remember`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        title: "docs/auth.md",
        content: "# Auth\nValidate JWT before route handlers.",
        kind: "doc"
      })
    });

    if (!(remember.ok && remember.payload.status === "ok" && remember.payload.stored >= 1)) {
      fail(2, "remember", remember);
    }

    const recall = await fetchJson(`${baseUrl}/api/recall`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        query: "jwt route handlers",
        limit: 5
      })
    });

    if (!(recall.ok && recall.payload.status === "ok" && recall.payload.total >= 1)) {
      fail(3, "recall", recall);
    }

    const chat = await fetchJson(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        query: "¿qué cambió en auth?",
        withContext: true,
        provider: "mock",
        chunks: recall.payload.chunks ?? []
      })
    });

    if (!(chat.ok && (chat.payload.status === "ok" || chat.payload.status === "blocked"))) {
      fail(4, "chat", chat);
    }

    if (!chat.payload.impact || typeof chat.payload.impact?.savings?.percent !== "number") {
      fail(5, "chat-impact", chat.payload);
    }

    const ask = await fetchJson(`${baseUrl}/api/ask`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        question: "Explain auth flow",
        provider: "mock",
        chunks: recall.payload.chunks ?? []
      })
    });

    if (!(ask.ok && (ask.payload.status === "ok" || ask.payload.status === "blocked"))) {
      fail(6, "ask", ask);
    }

    if (!ask.payload.impact || typeof ask.payload.impact?.savings?.percent !== "number") {
      fail(7, "ask-impact", ask.payload);
    }

    const guard = await fetchJson(`${baseUrl}/api/guard/output`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        output: String(chat.payload.response ?? ask.payload.generation?.content ?? ""),
        guardPolicyProfile: "learning_general"
      })
    });

    if (!(guard.status === 200 || guard.status === 422)) {
      fail(8, "guard", guard);
    }

    console.log(
      JSON.stringify(
        {
          status: "ok",
          e2e: {
            remember: remember.payload.status,
            recall: recall.payload.status,
            chat: chat.payload.status,
            ask: ask.payload.status,
            guard: guard.payload.status
          },
          impact: {
            chat: chat.payload.impact,
            ask: ask.payload.impact
          }
        },
        null,
        2
      )
    );
  } finally {
    if (started) {
      await server.stop();
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  fail(1, "runtime", error instanceof Error ? error.message : String(error));
});

