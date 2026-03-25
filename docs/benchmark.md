# Benchmark

## Qué es

Este proyecto ahora tiene benchmarks + gates formales:

1. **selector benchmark**: mide si entra el contexto correcto
2. **recall benchmark**: mide si la estrategia de memoria encuentra recuerdos útiles sin duplicarlos
3. **vertical benchmark**: mide el flujo integrado del vertical TypeScript en variantes comparables
4. **domain eval suite**: gate transversal por dominio (auth, security, observability, versioning)
5. **weight tuning benchmark**: compara perfiles de pesos del selector (NEXUS:3)

No mide “si se siente bien”. Mide comportamiento repetible.

## Archivos de casos

- `benchmark/selector-benchmark.json`
- `benchmark/recall-benchmark.json`
- `benchmark/vertical-benchmark.json`
- `benchmark/domain-eval-suite.json`

## Runners

```bash
npm run benchmark
npm run benchmark:recall
npm run benchmark:vertical
npm run eval:domains
npm run benchmark:tune
```

## Qué mide el selector benchmark

- `mustSelectRecall`: porcentaje de chunks obligatorios que sí fueron seleccionados
- `exclusionSuccess`: porcentaje de chunks prohibidos que sí quedaron afuera
- `relevantRatio`: porcentaje del contexto seleccionado que realmente es útil
- `topPrefixPass`: valida si los primeros lugares del ranking coinciden con el orden esperado

## Qué mide el recall benchmark

- `requiredRecall`: porcentaje de memorias esperadas que sí fueron recuperadas
- `queryEfficiency`: cuán rápido apareció la primera memoria útil
- `queryLimitPass`: valida que la estrategia no desperdicie demasiados intentos
- `firstMatchPass`: valida que el primer acierto ocurra dentro del rango esperado
- `exactChunkPass`: valida que la deduplicación no meta memorias repetidas

## Qué mide el vertical benchmark

- `codeFocusPass`: valida que el código principal siga siendo el archivo esperado
- `relatedTestPass`: valida que el test relacionado siga apareciendo como segundo eje
- `noiseExclusionPass`: valida que logs/chat sigan fuera
- `memoryBehaviorPass`: compara variantes sin memoria, con memoria seleccionada y con memoria suprimida por presupuesto

## Cómo usarlo

1. corrés benchmarks + domain gate antes de tocar ranking o recall
2. hacés cambios
3. los corrés de nuevo
4. comparás métricas

Si baja el `pass rate`, baja el `relevantRatio` o empeora `queryEfficiency`, el sistema retrocedió.

## Gate obligatorio de CI

`npm run eval:domains` está conectado al workflow de CI como bloqueo obligatorio.
Si una capa de dominio cae por debajo de umbral, la pipeline queda en `blocked`.
