#!/usr/bin/env node
// @ts-check

import { runCli } from "./cli/app.js";
import { buildCliJsonContract } from "./contracts/cli-contracts.js";

function wantsJson(argv) {
  return argv.includes("--format") && argv[argv.indexOf("--format") + 1] === "json";
}

const startedAt = Date.now();

try {
  const argv = process.argv.slice(2);
  const result = await runCli(argv);

  if (result.stdout) {
    console.log(result.stdout);
  }

  if (result.stderr) {
    console.error(result.stderr);
  }

  process.exitCode = result.exitCode;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const argv = process.argv.slice(2);

  if (wantsJson(argv)) {
    const command = argv[0] ?? "";
    console.error(
      JSON.stringify(
        buildCliJsonContract(command, {
          error: {
            message
          }
        }, {
          status: "error",
          generatedAt: new Date().toISOString(),
          cwd: process.cwd(),
          durationMs: Date.now() - startedAt
        }),
        null,
        2
      )
    );
  } else {
    console.error(message);
  }

  process.exitCode = 1;
}
