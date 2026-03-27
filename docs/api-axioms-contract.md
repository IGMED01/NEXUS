# `/api/axioms` — contrato objetivo

Estado: diseño funcional, todavía no implementado en runtime.

## Propósito
Exponer los axiomas activos de NEXUS para:
- shell/web
- synthesis de agentes
- validación de prompts
- auditoría humana

## Método inicial
`GET /api/axioms`

## Query params
- `project` — opcional, default `learning-context-system`
- `domain` — opcional (`typescript-node-cli`, `memory-architecture`, `guard-gates`)
- `protectedOnly` — opcional (`true|false`)
- `format` — opcional (`json`, `markdown`)

## Respuesta JSON esperada
```json
{
  "schemaVersion": "1.0.0",
  "status": "ok",
  "project": "learning-context-system",
  "count": 10,
  "axioms": [
    {
      "id": "guard-before-llm",
      "statement": "El guard evalúa antes de que el LLM vea el prompt.",
      "type": "architecture",
      "topic": "architecture/guard-order",
      "protected": true,
      "source": "obsidian",
      "domain": ["typescript-node-cli", "guard-gates"],
      "priority": 1
    }
  ],
  "sources": {
    "vault": ".lcs/obsidian-vault/NEXUS/Axioms/10-axiomas-fundacionales.md",
    "agents": [
      ".lcs/agents/axioms-arquitectura.md",
      ".lcs/agents/axioms-decisiones.md",
      ".lcs/agents/axioms-patrones.md",
      ".lcs/agents/axioms-lecciones.md"
    ]
  }
}
```

## Reglas del endpoint
1. Devuelve solo axiomas activos y no superseded.
2. Respeta `protectedOnly=true` para prompts críticos.
3. Puede fusionar fuentes de Obsidian y `.lcs/agents/`.
4. Debe mantener un orden estable por prioridad.
5. Si faltan fuentes, devuelve `warnings`, no 500.

## Backlog natural
- `POST /api/axioms/reload`
- `GET /api/axioms/:id`
- export markdown para UI/Obsidian deep links
