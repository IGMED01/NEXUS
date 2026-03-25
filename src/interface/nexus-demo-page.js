// @ts-check

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEMO_PAGE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "nexus-demo-page.html"
);

/**
 * NEXUS:8 + NEXUS:9 + NEXUS:10 — visual dashboard + API playground.
 */
export function buildNexusDemoPage() {
  return readFileSync(DEMO_PAGE_PATH, "utf8");
}