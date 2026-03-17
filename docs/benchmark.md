# Benchmark

## Qué es

Este benchmark mide si el sistema selecciona el contexto correcto en casos repetibles.

No mide "si se siente bien". Mide:

- si entran chunks obligatorios
- si quedan afuera chunks prohibidos
- si el top del ranking está bien ordenado
- cuánto del contexto seleccionado es realmente relevante

## Archivo de casos

- `benchmark/selector-benchmark.json`

Cada caso define:

- `mode`: `select` o `teach`
- `input`: foco, archivos cambiados, presupuesto y chunks
- `expectations`: qué debe entrar, qué debe quedar afuera y qué debe quedar arriba

## Runner

```bash
npm run benchmark
```

## Métricas

- `mustSelectRecall`: porcentaje de chunks obligatorios que sí fueron seleccionados
- `exclusionSuccess`: porcentaje de chunks prohibidos que sí quedaron afuera
- `relevantRatio`: porcentaje del contexto seleccionado que realmente pertenece al conjunto relevante
- `topPrefixPass`: valida si los primeros lugares del ranking coinciden con el orden esperado

## Cómo usarlo

1. corrés el benchmark antes de tocar el ranking
2. hacés cambios
3. lo corrés de nuevo
4. comparás métricas

Si el `pass rate` baja o el `relevant ratio` cae, el ranking empeoró.
