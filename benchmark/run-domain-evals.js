// @ts-check

import path from "node:path";

import {
  formatDomainEvalSuiteReport,
  loadDomainEvalSuite,
  runDomainEvalSuite
} from "../src/eval/domain-eval-suite.js";

async function main() {
  const suitePath = path.resolve(process.argv[2] ?? "benchmark/domain-eval-suite.json");
  const suite = await loadDomainEvalSuite(suitePath);
  const report = runDomainEvalSuite(suite);

  console.log(formatDomainEvalSuiteReport(report));
  console.log("");
  console.log("Summary:");
  console.log(JSON.stringify(report.summary, null, 2));

  if (report.status !== "pass") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});