# `/api/axioms` — checklist de implementación

Estado: planificación operativa.  
Objetivo: implementar `/api/axioms` sin romper contratos existentes y usando como fuente principal el conocimiento ya capturado en:

- `C:\Users\Admin\Desktop\Nueva carpeta (3)\.lcs\obsidian-vault\NEXUS\Axioms\10-axiomas-fundacionales.md`
- `C:\Users\Admin\Desktop\Nueva carpeta (3)\.lcs\agents\axioms-arquitectura.md`
- `C:\Users\Admin\Desktop\Nueva carpeta (3)\.lcs\agents\axioms-decisiones.md`
- `C:\Users\Admin\Desktop\Nueva carpeta (3)\.lcs\agents\axioms-patrones.md`
- `C:\Users\Admin\Desktop\Nueva carpeta (3)\.lcs\agents\axioms-lecciones.md`

---

## P0 — contrato mínimo del endpoint

- [ ] crear handler `GET /api/axioms`
- [ ] soportar query params:
  - [ ] `project`
  - [ ] `domain`
  - [ ] `protectedOnly`
  - [ ] `format`
- [ ] devolver `schemaVersion`, `status`, `project`, `count`, `axioms`, `sources`
- [ ] mantener `warnings` cuando falten fuentes o una fuente sea inválida
- [ ] no lanzar 500 por ausencia de vault o archivo; degradar en forma explícita

### DoD P0
- [ ] `GET /api/axioms` responde en JSON estable
- [ ] si no hay fuentes, devuelve `status=ok`, `count=0`, `warnings`

---

## P1 — capa de lectura y normalización

- [ ] crear loader de axiomas desde Obsidian
- [ ] crear loader de axiomas desde `.lcs/agents`
- [ ] normalizar cada axioma a un shape único:
  - [ ] `id`
  - [ ] `statement`
  - [ ] `type`
  - [ ] `topic`
  - [ ] `protected`
  - [ ] `source`
  - [ ] `domain`
  - [ ] `priority`
- [ ] deduplicar por `topic` o `statement`
- [ ] ordenar por prioridad estable
- [ ] fusionar fuentes sin perder trazabilidad

### DoD P1
- [ ] un mismo axioma no sale duplicado aunque exista en vault y en `.lcs/agents`
- [ ] el orden es determinista entre corridas

---

## P2 — reglas de negocio

- [ ] `protectedOnly=true` devuelve solo axiomas protegidos
- [ ] `domain=typescript-node-cli` filtra axiomas relevantes
- [ ] si `format=markdown`, devolver salida legible para shell/UI
- [ ] ignorar notas `superseded`
- [ ] permitir fuentes parciales sin romper respuesta total

### DoD P2
- [ ] el filtro por dominio reduce la lista de forma coherente
- [ ] `protectedOnly=true` deja solo constitución crítica

---

## P3 — integración con API actual

- [ ] registrar la ruta en:
  - [ ] `C:\Users\Admin\Desktop\Nueva carpeta (3)\src\api\handlers.ts`
- [ ] exponer el contrato en OpenAPI
- [ ] sumar ejemplo de respuesta
- [ ] asegurar que la respuesta incluya `sources`

### DoD P3
- [ ] `/api/axioms` aparece en OpenAPI
- [ ] el handler usa loaders internos, no lógica duplicada

---

## P4 — tests

- [ ] fixture de contrato JSON
- [ ] test feliz con vault + `.lcs/agents`
- [ ] test degradado sin vault
- [ ] test con duplicados entre fuentes
- [ ] test con `protectedOnly=true`
- [ ] test con `domain=typescript-node-cli`
- [ ] test `format=markdown`

### DoD P4
- [ ] tests verdes sin tocar otros contratos
- [ ] fixture de respuesta estable agregado

---

## P5 — observabilidad y operabilidad

- [ ] registrar métrica de uso de `/api/axioms`
- [ ] registrar si respondió degradado
- [ ] exponer cuántas fuentes participaron
- [ ] exponer cuántos axiomas fueron filtrados por duplicado

### DoD P5
- [ ] el endpoint deja evidencia operativa útil en observabilidad

---

## P6 — integración futura

- [ ] conectar `/api/axioms` con `axiom-store`
- [ ] usar `/api/axioms` como fuente de prompts/agentes
- [ ] habilitar deep links a Obsidian con `obsidian://`
- [ ] definir posible `POST /api/axioms/reload`
- [ ] definir posible `GET /api/axioms/:id`

---

## Riesgos a evitar

- [ ] no parsear markdown completo de forma frágil si alcanza con headings + listas
- [ ] no convertir Obsidian en dependencia dura del runtime
- [ ] no duplicar axiomas entre handler, store y UI
- [ ] no mezclar axiomas activos con cuarentena o drafts

---

## Orden estricto de ejecución

1. **P0** contrato mínimo
2. **P1** loaders + normalización
3. **P2** reglas de negocio
4. **P3** integración API/OpenAPI
5. **P4** tests
6. **P5** observabilidad
7. **P6** integración futura

---

## Criterio final de cierre

- [ ] `/api/axioms` responde aunque falte una fuente
- [ ] el contrato es estable
- [ ] no rompe rutas existentes
- [ ] ya sirve para shell, web y synthesis de agentes
