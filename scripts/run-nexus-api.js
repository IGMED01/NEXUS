#!/usr/bin/env node
import { createNexusApiServer } from "../src/api/server.js";
import { loadProjectConfig } from "../src/io/config-file.js";

async function main() {
  const configInfo = await loadProjectConfig({
    cwd: process.cwd()
  });
  const config = configInfo.config;
  const host = process.env.NEXUS_API_HOST || "127.0.0.1";
  const port = Number(process.env.NEXUS_API_PORT || 8787);

  const server = createNexusApiServer({
    host,
    port,
    auth: {
      requireAuth: config.llm?.requireAuth !== false,
      apiKeys: Array.isArray(config.llm?.apiKeys) ? config.llm.apiKeys : []
    },
    llm: {
      defaultProvider: config.llm?.provider || "claude",
      claude: {
        model: config.llm?.model,
        defaultMaxTokens: config.llm?.maxTokens,
        defaultTemperature: config.llm?.temperature
      },
      tokenBudget: config.llm?.tokenBudget,
      maxChunks: config.llm?.maxContextChunks
    },
    sync: {
      rootPath: config.workspace || process.cwd(),
      autoStart: true,
      intervalMs: 60_000
    }
  });

  const started = await server.start();

  console.log(`NEXUS API listening on http://${started.host}:${started.port}`);

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
