import { runCli } from "../src/cli/app.js";

const PROJECT = "typescript-backend-vertical";

const memories = [
  {
    title: "Auth validation order",
    content:
      "Authenticate before route handlers so expired sessions fail at the boundary and handlers receive a stable auth context.",
    type: "decision",
    topic: "architecture/auth-validation-order"
  },
  {
    title: "Request context is middleware-owned",
    content:
      "Middleware enriches RequestContext once so handlers depend on a typed auth shape instead of parsing headers repeatedly.",
    type: "architecture",
    topic: "architecture/request-context-boundary"
  },
  {
    title: "Expired sessions never reach handlers",
    content:
      "When a session is expired the middleware must return 401 immediately and avoid calling the downstream route.",
    type: "pattern",
    topic: "pattern/expired-session-short-circuit"
  }
];

for (const memory of memories) {
  const result = await runCli([
    "remember",
    "--title",
    memory.title,
    "--content",
    memory.content,
    "--project",
    PROJECT,
    "--type",
    memory.type,
    "--topic",
    memory.topic,
    "--format",
    "text"
  ]);

  if (result.exitCode !== 0) {
    console.error(result.stderr || result.stdout);
    process.exitCode = 1;
    break;
  }

  console.log(result.stdout);
  console.log("");
}
