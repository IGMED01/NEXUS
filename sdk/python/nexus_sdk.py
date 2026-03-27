"""
NEXUS Python SDK — Sprint 7 / NEXUS:10 INTERFACE

Minimal client for the NEXUS HTTP API (port 3100).
Covers the core operations:
  - select: retrieve relevant context chunks
  - ask: teach + LLM response
  - benchmark: run comparison benchmark
  - gate: run Code Gate / architecture / deprecation checks
  - axioms: store and query code axioms (reusable knowledge)

Usage:
    from nexus_sdk import NexusClient

    client = NexusClient(base_url="http://localhost:3100")

    # Select relevant context
    result = client.select(
        workspace=".",
        focus="jwt middleware expired session",
        token_budget=350,
        max_chunks=5
    )
    print(result["selected"])

    # Run the Code Gate
    gate = client.code_gate(tools=["typecheck", "lint"])
    if not gate["passed"]:
        print(gate["formattedErrors"])

    # Store a code axiom
    client.axiom_save(
        project="my-project",
        type="library-gotcha",
        title="Express body-parser deprecated",
        body="Use express.json() instead of body-parser since Express 4.16.",
        language="typescript",
        framework="express"
    )
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional


class NexusError(Exception):
    """Raised when the NEXUS API returns an error response."""

    def __init__(self, status: int, message: str, body: Dict[str, Any]) -> None:
        super().__init__(f"NEXUS API error {status}: {message}")
        self.status = status
        self.body = body


class NexusClient:
    """
    Minimal Python client for the NEXUS HTTP API.

    Args:
        base_url: Base URL of the running NEXUS API server.
                  Default: http://localhost:3100
        timeout:  Request timeout in seconds. Default: 30.
    """

    def __init__(self, base_url: str = "http://localhost:3100", timeout: int = 30) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    # ── Transport ─────────────────────────────────────────────────────────────

    def _request(
        self,
        method: str,
        path: str,
        body: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None

        all_headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if headers:
            all_headers.update(headers)

        req = urllib.request.Request(url, data=data, headers=all_headers, method=method)

        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8") if exc.fp else ""
            body_parsed: Dict[str, Any] = {}
            try:
                body_parsed = json.loads(raw)
            except json.JSONDecodeError:
                pass
            raise NexusError(exc.code, exc.reason, body_parsed) from exc

    def _post(self, path: str, body: Dict[str, Any], headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return self._request("POST", path, body, headers)

    def _get(self, path: str, headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return self._request("GET", path, headers=headers)

    # ── Core operations ───────────────────────────────────────────────────────

    def select(
        self,
        workspace: str = ".",
        focus: str = "",
        token_budget: int = 350,
        max_chunks: int = 6,
        min_score: float = 0.25,
        changed_files: Optional[List[str]] = None,
        project: Optional[str] = None,
        scoring_profile: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Select relevant context chunks for a given focus query.

        Returns a dict with:
          selected: list of selected chunks
          suppressed: list of suppressed chunks
          summary: selection summary metrics
          structuralHits: count of structurally-matched chunks (Sprint 2)
        """
        payload: Dict[str, Any] = {
            "workspace": workspace,
            "focus": focus,
            "tokenBudget": token_budget,
            "maxChunks": max_chunks,
            "minScore": min_score,
        }
        if changed_files:
            payload["changedFiles"] = changed_files
        if project:
            payload["project"] = project
        if scoring_profile:
            payload["scoringProfile"] = scoring_profile

        return self._post("/api/teach", payload)

    def teach(
        self,
        task: str,
        objective: str,
        workspace: str = ".",
        changed_files: Optional[List[str]] = None,
        project: Optional[str] = None,
        recall_query: Optional[str] = None,
        token_budget: int = 350,
        max_chunks: int = 6,
        no_recall: bool = False,
    ) -> Dict[str, Any]:
        """
        Run the teach command — builds a learning packet for the given task.

        Returns the full LearningPacket with selected context, structural hits,
        teaching sections, and memory recall state.
        """
        payload: Dict[str, Any] = {
            "task": task,
            "objective": objective,
            "workspace": workspace,
            "tokenBudget": token_budget,
            "maxChunks": max_chunks,
            "noRecall": no_recall,
        }
        if changed_files:
            payload["changedFiles"] = changed_files
        if project:
            payload["project"] = project
        if recall_query:
            payload["recallQuery"] = recall_query

        return self._post("/api/teach", payload)

    def recall(
        self,
        query: str,
        project: str = "default",
        scope: str = "project",
        limit: int = 5,
    ) -> Dict[str, Any]:
        """Retrieve memories from the memory store matching a query."""
        return self._post("/api/recall", {
            "query": query,
            "project": project,
            "scope": scope,
            "limit": limit,
        })

    def remember(
        self,
        title: str,
        content: str,
        type: str = "decision",
        project: str = "default",
        scope: str = "project",
        topic: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Store a memory entry."""
        payload: Dict[str, Any] = {
            "title": title,
            "content": content,
            "type": type,
            "project": project,
            "scope": scope,
        }
        if topic:
            payload["topic"] = topic
        return self._post("/api/remember", payload)

    # ── Benchmark ─────────────────────────────────────────────────────────────

    def benchmark(self, workspace: str = ".", project: str = "default") -> Dict[str, Any]:
        """
        Run the NEXUS vs raw-context benchmark.

        Returns savings (chunks, tokens, %), structural hits, and quality pass rate.
        """
        return self._post("/api/teach", {
            "task": "benchmark",
            "objective": "Compare NEXUS vs raw context",
            "workspace": workspace,
            "project": project,
            "tokenBudget": 350,
            "maxChunks": 6,
            "noRecall": True,
        })

    # ── Code Gate & Repair Loop (Sprint 3 / Sprint 4) ─────────────────────────

    def code_gate(
        self,
        cwd: Optional[str] = None,
        tools: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Run the Code Gate — lint, typecheck, build, or test.

        Returns:
          status: "pass" | "fail" | "skipped" | "degraded"
          passed: bool
          errorCount: int
          formattedErrors: str
          tools: list of per-tool results
        """
        payload: Dict[str, Any] = {"tools": tools or ["typecheck", "lint"]}
        if cwd:
            payload["cwd"] = cwd
        return self._post("/api/code-gate", payload)

    def repair(
        self,
        code: str,
        cwd: Optional[str] = None,
        tools: Optional[List[str]] = None,
        max_iterations: int = 3,
        context: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Run the repair loop — draft → gate → parse → repair → rerun.

        Returns:
          success: bool
          finalCode: str
          reason: "pass" | "max-iterations" | "no-progress" | "error"
          totalAttempts: int
          trace: str
        """
        payload: Dict[str, Any] = {
            "code": code,
            "tools": tools or ["typecheck", "lint"],
            "maxIterations": max_iterations,
        }
        if cwd:
            payload["cwd"] = cwd
        if context:
            payload["context"] = context
        return self._post("/api/repair", payload)

    # ── Architecture & Deprecation Gates (Sprint 6) ────────────────────────────

    def architecture_gate(
        self,
        files: Dict[str, str],
        cwd: Optional[str] = None,
        rules: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Check files against declared architecture rules.

        Args:
          files: dict mapping file paths to their content strings
          cwd: project root (for loading nexus-architecture.json)
          rules: optional override rules list

        Returns:
          passed: bool
          violations: list of violation dicts
          formatted: human-readable summary
        """
        payload: Dict[str, Any] = {"files": files}
        if cwd:
            payload["cwd"] = cwd
        if rules:
            payload["rules"] = rules
        return self._post("/api/architecture-gate", payload)

    def deprecation_gate(
        self,
        files: Dict[str, str],
        cwd: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Check files for deprecated API usage and forbidden packages.

        Returns:
          passed: bool
          violations: list
          forbiddenPackages: list
          versionWarnings: list
          formatted: str
        """
        payload: Dict[str, Any] = {"files": files}
        if cwd:
            payload["cwd"] = cwd
        return self._post("/api/deprecation-gate", payload)

    # ── Axiom Memory (Sprint 5) ────────────────────────────────────────────────

    def axiom_save(
        self,
        type: str,
        title: str,
        body: str,
        project: str = "default",
        language: str = "*",
        path_scope: str = "*",
        framework: str = "*",
        version: Optional[str] = None,
        ttl_days: Optional[int] = None,
        tags: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Store a code axiom (reusable knowledge) in the axiom store.

        Returns: { saved: bool, id: str, duplicate: bool }
        """
        payload: Dict[str, Any] = {
            "project": project,
            "type": type,
            "title": title,
            "body": body,
            "language": language,
            "pathScope": path_scope,
            "framework": framework,
            "tags": tags or [],
        }
        if version:
            payload["version"] = version
        if ttl_days is not None:
            payload["ttlDays"] = ttl_days
        return self._post("/api/axioms", payload)

    def axiom_query(
        self,
        project: str = "default",
        language: Optional[str] = None,
        path_scope: Optional[str] = None,
        framework: Optional[str] = None,
        focus_terms: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Query axioms relevant to the given context.

        Returns: { axioms: list, block: str, count: int }
        """
        payload: Dict[str, Any] = {"project": project}
        if language:
            payload["language"] = language
        if path_scope:
            payload["pathScope"] = path_scope
        if framework:
            payload["framework"] = framework
        if focus_terms:
            payload["focusTerms"] = focus_terms
        return self._post("/api/axioms/query", payload)

    def axiom_list(self, project: str = "default") -> Dict[str, Any]:
        """List all active axioms for a project."""
        return self._get("/api/axioms", headers={"x-project": project})

    # ── Mitosis Digital — Emergent Agent Synthesis (Sprint 8) ─────────────────

    def mitosis_run(
        self,
        project: str = "default",
        data_dir: str = ".",
        min_axioms: int = 5,
        min_maturity_score: float = 0.4,
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        """
        Run the Mitosis pipeline: detect axiom clusters → check maturity → synthesize agents.

        Returns:
          clustersDetected: int
          matureClusters: int
          agentsBorn: int
          agents: list of AgentProfile dicts
          clusters: list of AxiomCluster dicts
          formatted: human-readable mitosis report
          dryRun: bool
        """
        return self._post("/api/mitosis", {
            "project": project,
            "dataDir": data_dir,
            "minAxioms": min_axioms,
            "minMaturityScore": min_maturity_score,
            "dryRun": dry_run,
        })

    def agent_list(self, data_dir: str = ".") -> Dict[str, Any]:
        """
        List all born specialist agents.

        Returns: { agents: list[AgentProfile], count: int }
        """
        return self._get("/api/agents", headers={"x-data-dir": data_dir})

    def agent_route(
        self,
        language: Optional[str] = None,
        framework: Optional[str] = None,
        data_dir: str = ".",
    ) -> Dict[str, Any]:
        """
        Find the best born agent for a given language/framework task.

        Returns:
          matched: bool
          agent: AgentProfile | None
          message: str (when no match)
        """
        payload: Dict[str, Any] = {"dataDir": data_dir}
        if language:
            payload["language"] = language
        if framework:
            payload["framework"] = framework
        return self._post("/api/agents/route", payload)

    # ── Observability ──────────────────────────────────────────────────────────

    def metrics(self) -> Dict[str, Any]:
        """Return the current observability metrics snapshot."""
        return self._get("/api/metrics")

    def health(self) -> Dict[str, Any]:
        """Return the NEXUS health / doctor check result."""
        return self._get("/api/health")


# ── CLI example ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    client = NexusClient()

    command = sys.argv[1] if len(sys.argv) > 1 else "health"

    if command == "health":
        result = client.health()
        print(json.dumps(result, indent=2))
    elif command == "metrics":
        result = client.metrics()
        print(json.dumps(result, indent=2))
    elif command == "gate":
        result = client.code_gate()
        print(f"Gate status: {result.get('status')}")
        if result.get("formattedErrors"):
            print(result["formattedErrors"])
    elif command == "axioms":
        result = client.axiom_list(project=sys.argv[2] if len(sys.argv) > 2 else "default")
        print(json.dumps(result, indent=2))
    elif command == "mitosis":
        # python nexus_sdk.py mitosis [project] [--dry-run]
        project = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith("--") else "default"
        dry_run = "--dry-run" in sys.argv
        result = client.mitosis_run(project=project, dry_run=dry_run)
        print(result.get("formatted", json.dumps(result, indent=2)))
    elif command == "agents":
        # python nexus_sdk.py agents
        result = client.agent_list()
        agents = result.get("agents", [])
        if not agents:
            print("No born agents yet. Run 'mitosis' to synthesize specialist agents.")
        else:
            for a in agents:
                print(f"  [{a['id']}] {a['domain']} v{a['version']} maturity={a['maturityScore']:.0%} born={a['bornAt'][:10]}")
    elif command == "agent-route":
        # python nexus_sdk.py agent-route --language typescript --framework express
        language = None
        framework = None
        args = sys.argv[2:]
        for i, arg in enumerate(args):
            if arg == "--language" and i + 1 < len(args):
                language = args[i + 1]
            elif arg == "--framework" and i + 1 < len(args):
                framework = args[i + 1]
        result = client.agent_route(language=language, framework=framework)
        if result.get("matched"):
            agent = result["agent"]
            print(f"Matched agent: [{agent['id']}] {agent['domain']} v{agent['version']}")
            print(f"System prompt preview:\n{agent['systemPrompt'][:500]}...")
        else:
            print(result.get("message", "No matching agent found."))
    else:
        print(f"Unknown command: {command}")
        print("Available: health, metrics, gate, axioms [project], mitosis [project] [--dry-run], agents, agent-route [--language L] [--framework F]")
        sys.exit(1)
