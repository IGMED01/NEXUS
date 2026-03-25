#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildNexusOpenApiSpec } from "../src/interface/nexus-openapi.js";

async function main() {
  const outputPath = path.resolve(process.argv[2] ?? "docs/openapi/nexus-openapi.json");
  const spec = buildNexusOpenApiSpec();

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");

  console.log(`OpenAPI exported to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});