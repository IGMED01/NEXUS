---
name: lcs-session-ops
description: >
  Operaciones de sesión y roadmap para NEXUS/LCS. Usar cuando el usuario quiera:
  cerrar una sesión de trabajo (close + memoria), capturar axiomas o decisiones,
  ver el estado de la checklist técnica o la suya, agregar una memoria al proyecto,
  o planificar el próximo bloque de trabajo. También útil para revisar qué bloque
  de la checklist sigue, qué archivos están pendientes, o cuál es el estado de la
  migración Engram → memoryClient.
---

# LCS Session Ops

## Comportamiento central

- Siempre leer `.lcs/CHECKLIST.md` y `.lcs/CHECKLIST-TU.md` antes de responder sobre estado del roadmap.
- Al cerrar sesión: ejecutar `close` con resumen, aprendizaje y próximo paso, luego confirmar que quedó guardado.
- Al capturar axiomas: usar formato de una línea, contundente, verificable. Guardar en `.lcs/agents/axioms-{tipo}.md` Y en memoria con `remember --type decision`.
- Al mostrar estado: mostrar qué está hecho (✅), en progreso (🔄), pendiente (⬜), y bloqueado (🔴) con la razón.
- Siempre indicar la sincronía: qué tarea del usuario desbloquea qué tarea técnica.

---

## Comando: cerrar sesión

```bash
node src/cli.js close \
  --summary "{resumen de lo que se hizo}" \
  --learned "{qué se aprendió o confirmó}" \
  --next "{qué sigue en el próximo bloque}" \
  --project learning-context-system
```

Verificar que guardó:
```bash
node src/cli.js recall \
  --project learning-context-system \
  --type learning \
  --limit 1 \
  --format json
```

---

## Comando: capturar axioma

```bash
# Solo en archivo .md (para clasificar después):
echo "## Axioma: {título}" >> .lcs/agents/axioms-arquitectura.md

# En memoria permanente (para recall automático):
node src/cli.js remember \
  --title "Axioma: {título corto}" \
  --content "{axioma completo con contexto y razón}" \
  --type decision \
  --project learning-context-system \
  --topic "arquitectura/{subtema}"
```

---

## Comando: ver estado de memoria

```bash
# Memorias recientes:
node src/cli.js recall --project learning-context-system --limit 5 --format json

# Por tipo:
node src/cli.js recall --project learning-context-system --type decision --limit 10

# Axiomas guardados:
cat .lcs/agents/axioms-*.md 2>/dev/null
```

---

## Comando: ver estado del roadmap técnico

```bash
# Estado de tests (referencia):
npm test -- 2>&1 | tail -5

# Typecheck:
npm run typecheck 2>&1 | tail -10

# Doctor:
node src/cli.js doctor --format json
```

---

## Estado de la checklist técnica (resumen)

| Fase | Descripción | Estado |
|------|-------------|--------|
| 1.1 | `local-memory-store.js` + `resilient-client`: agregar `search()` + `save()` | ⬜ |
| 1.2 | `app.js`: migrar recall/remember/close a nueva interfaz | ⬜ |
| 1.3 | `test/run-tests.js`: fakeClients + fixtures | ⬜ |
| 1.4 | Borrar `engram-client.js` + `engram-auto-orchestrator.js` | ⬜ |
| 2.x | Integrar sprint files del worktree (gates, RTK, axioms, orchestration) | ⬜ |
| 3.x | Mitosis Digital: agent-synthesizer + API + SDK | ⬜ |

Leer la checklist completa: `cat .lcs/CHECKLIST.md`
Leer la checklist del usuario: `cat .lcs/CHECKLIST-TU.md`

---

## Checklist del usuario (resumen)

| Bloque | Descripción | Desbloquea |
|--------|-------------|------------|
| 1.1–1.4 | Limpiar memoria de test, primera memoria real, hábito de close | Fase 1 técnica |
| 2.1–2.5 | 10 axiomas fundacionales en 4 categorías | Fase 2 (axiom-store) |
| 3.1–3.3 | Primer dominio de agente, routing.json, borrador system prompt | Fase 3 (Mitosis) |
| 4.1–4.2 | Decisiones pasadas, contrato de calidad | Primer agente maduro |
| 5.x | Visión 12m, distribución, proyectos reales | Estrategia de largo plazo |

---

## Archivos clave del roadmap

```
.lcs/CHECKLIST.md              → checklist técnica detallada (mi trabajo)
.lcs/CHECKLIST-TU.md           → checklist del usuario (conocimiento + visión)
.lcs/ESTRATEGIA-RUFLO-PRIVADO.md → plan de salida de Ruflo (4 fases)
.lcs/agents/routing.json       → registro de agentes (crear cuando sea necesario)
.lcs/agents/axioms-*.md        → axiomas por categoría
.lcs/decisions/                → decisiones documentadas del proyecto
```

---

## Reglas de operación

- **Engram es batería externa** — no se borra; es fallback nivel 3. Si Ruflo no responde, Engram entra.
- **Ruflo es temporal** — runtime de agentes mientras NEXUS sintetiza los propios.
- **Axiomas son el activo real** — sin axiomas, Mitosis no puede sintetizar.
- **Tests verdes antes de borrar** — nunca eliminar legacy hasta que 178/178 pase sin él.
- **Un bloque, un commit** — no mezclar deuda técnica con feature en el mismo PR.

---

## Próximo paso sugerido

Si el usuario no sabe por dónde empezar:
1. Leer estado actual: `npm test 2>&1 | tail -3`
2. Identificar fase activa en `CHECKLIST.md`
3. Ejecutar la primera tarea pendiente de esa fase
4. Al terminar: `close` + actualizar el estado en la checklist
