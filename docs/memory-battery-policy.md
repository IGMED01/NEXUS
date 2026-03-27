# Memory Battery Policy

## Objetivo

Mejorar la capa de memoria sin volver a acoplar NEXUS a Engram.

La regla del repo pasa a ser esta:

> **Engram se usa solo como bateria externa de contingencia.**
> **No es dependencia principal del runtime.**

---

## Orden estricto de runtime

1. **Local JSONL**  
   Base de continuidad operativa y escritura durable minima.

2. **Ruflo / tier semantico local**  
   Capa de mejora para recall semantico y ranking.

3. **Engram (bateria externa)**  
   Se usa solo si la cadena principal falla o si se activa una recuperacion excepcional.

### Reglas no negociables

- NEXUS debe seguir funcionando sin Engram.
- NEXUS no debe arrancar ni fallar duro por ausencia de Engram.
- El path principal no debe volver a parsear `stdout` de Engram como contrato normal.
- Toda activacion de Engram debe quedar marcada en salida, observabilidad y doctor.
- `local-only` debe seguir siendo el modo canonico de continuidad.
- El modo resiliente debe priorizar **Ruflo + local** antes de cualquier bateria externa.

---

## Checklist de recuperacion tecnica

### 1. Cerrar deuda legacy de Engram

- [ ] Eliminar naming legacy de Engram en help, docs, formatters y mensajes de CLI.
- [ ] Reemplazar `origin: "engram"` por una etiqueta neutral (`memory` o equivalente) en contratos internos donde ya no represente el proveedor real.
- [ ] Quitar referencias a flags viejos (`--engram-bin`, `--engram-data-dir`) del camino principal y dejarlas solo en la integracion de bateria si siguen existiendo.
- [ ] Dejar `engram-only` como modo legacy controlado o retirarlo de la ayuda publica si ya no es camino recomendado.

### 2. Recuperar las capacidades que se perdieron

- [ ] Restaurar recall semantico real con Ruflo disponible en entorno sano.
- [ ] Mantener continuidad durable con local JSONL cuando falle el tier semantico.
- [ ] Recuperar paridad funcional de:
  - [ ] `search`
  - [ ] `save`
  - [ ] `recent context`
  - [ ] clasificacion de fallos
- [ ] Asegurar que el flujo principal use tipos estructurados (`MemoryEntry[]`) y no strings parseados.

### 3. Integrar Engram como bateria externa real

- [ ] Encapsular Engram en un adapter aislado de contingencia.
- [ ] Activar Engram solo por:
  - [ ] fallo del tier principal
  - [ ] recuperacion manual
  - [ ] diagnostico/controlado
- [ ] Marcar siempre en la salida:
  - [ ] `provider`
  - [ ] `fallbackUsed`
  - [ ] `failureKind`
  - [ ] `fixHint`
- [ ] Registrar en observabilidad cada uso de la bateria externa.
- [ ] Hacer visible en `doctor` si Engram esta:
  - [ ] disponible
  - [ ] no disponible
  - [ ] deshabilitado por politica

### 4. Endurecer validacion y seguridad

- [ ] Añadir tests para:
  - [ ] `local-only`
  - [ ] `resilient` con Ruflo sano
  - [ ] `resilient` degradando a local
  - [ ] `battery fallback` a Engram
  - [ ] error classification consistente
- [ ] Verificar que el path de contingencia no rompa memory hygiene.
- [ ] Evitar que Engram reintroduzca memorias con contratos viejos o metadata perdida.
- [ ] Exigir que cualquier uso de bateria externa mantenga backward compatibility de JSON contracts.

### 5. Sanear la memoria antes de medir

- [ ] Limpiar memorias de test del store real.
- [ ] Compactar duplicados.
- [ ] Proteger axiomas/decisiones reales.
- [ ] Repetir benchmark y doctor-memory con memoria sana.

### 6. Medir si realmente mejoramos

- [ ] Comparar:
  - [ ] recall hit rate
  - [ ] degraded rate
  - [ ] duplicate rate
  - [ ] noise rate
  - [ ] average health score
  - [ ] latencia de recall
- [ ] Confirmar que con la nueva cadena:
  - [ ] NEXUS no pierde continuidad
  - [ ] NEXUS no empeora tokens/chunks
  - [ ] Engram queda como respaldo y no como muleta principal

---

## Definicion de listo

Esto se considera bien cerrado cuando:

- `doctor` deja claro que la cadena canonica es **Ruflo + local**
- Engram aparece solo como **external battery**
- el repo ya no comunica Engram como runtime principal
- los tests cubren el fallback de bateria
- la memoria esta suficientemente limpia para medir valor real

