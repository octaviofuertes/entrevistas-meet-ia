# Informe de Ejecución — Robustez de la capa TTS (crash y cuelgue de msedge-tts)

## Metadatos

- **Ticket:** FIX-TTS-ROBUSTEZ
- **Versión:** v1.0
- **Fecha:** 2026-07-10
- **Plan ejecutado:** `ENTREVISTADOR_IA_LEIA_FIX-TTS-ROBUSTEZ_PLAN_EJECUTOR_v1.0.md`
- **Análisis del Arquitecto:** `ENTREVISTADOR_IA_LEIA_FIX-TTS-ROBUSTEZ_ARQUITECTO_v1.0.md`
- **Branch:** `feature/arnes-etapa-1-candidato`
- **Base verificada:** commit `5b26319` = HEAD al iniciar (confirmado con `git log`).

---

## Estado por Tarea

| Tarea | Estado | Notas |
|---|---|---|
| T01 — `withTimeout` + EdgeTTS robusto | COMPLETADA-VALIDADA | `npm run build --workspace=backend` sin errores |
| T02 — AbortSignal.timeout en GeminiTTS | COMPLETADA-VALIDADA | `npm run build --workspace=backend` sin errores |
| T03 — Handler global + script de verificación | COMPLETADA-VALIDADA | Script ejecutado, exit 0, `SOBREVIVIO` impreso; control negativo confirmado (ver §Verificación) |
| T04 — Tests unitarios `tts.test.ts` | COMPLETADA-VALIDADA | 4/4 tests nuevos en verde |
| T05 — Verificación final | COMPLETADA-VALIDADA | Build + suite completa + script + smoke real, todos verdes |

---

## Log de Desviaciones

Ninguna. El plan se ejecutó tal como estaba especificado, sin desviaciones menores ni mayores.

---

## Resultados de Verificación

### Build

```
npm run build --workspace=backend
> tsc
(sin errores)
```

### Suite completa (vitest)

```
Test Files  8 passed (8)
     Tests  47 passed (47)
```

Desglose: los 43 tests preexistentes siguen verdes + 4 nuevos en `src/services/tts/tts.test.ts`:
- `withTimeout` resuelve con el valor si la promesa termina antes del límite.
- `withTimeout` rechaza con mensaje `/timeout/` si la promesa nunca resuelve (fake timers).
- `EdgeTTS` con `msedge-tts` mockeado devolviendo un stream que nunca emite `end`: `synthesize()` NO cuelga, resuelve con el resultado del `MockTTS` (`mimeType: 'audio/mpeg'`, `audioBase64` no vacío) tras el timeout de 50ms inyectado en el test.
- Tras esa falla, el cliente cacheado se descartó: la segunda síntesis reconstruye el cliente (contador de invocaciones del constructor mockeado pasa de 1 a 2).

### Script de verificación (T03) — evidencia de la red de seguridad

Comando: `npx tsx scripts/verify-unhandled-rejection.ts`

```
[handler] unhandledRejection capturada, proceso sigue vivo: Error: Edge TTS WebSocket error: (code=ETIMEDOUT)
SOBREVIVIO
EXIT_CODE=0
```

**Control negativo** (mismo patrón exacto, sin el handler — corrido inline, no forma parte de ningún archivo del repo):

```
npx tsx -e "Promise.reject(new Error('Edge TTS WebSocket error: (code=ETIMEDOUT)')).then(); ..."
Error: Edge TTS WebSocket error: (code=ETIMEDOUT)
    at [eval]:2:16
    ...
EXIT_CODE=1
```

Confirma la causa raíz documentada por el Arquitecto: la misma promesa flotante que mata el proceso sin el handler, sobrevive limpiamente con él.

### Smoke de regresión con Edge real (T05, opcional — ejecutado)

Comando: `npx tsx scripts/test-edge-tts.ts` (síntesis real contra el servicio de Microsoft, sin mocks)

```
Sintetizando con Edge TTS (es-AR-ElenaNeural)...
elapsed ms: 3262
mimeType: audio/mpeg
base64 length: 66240
bytes: 49680
durationMs: 5000
first 4 bytes (ascii): "sdD"
OK = true
```

Síntesis real exitosa en ~3.2s, muy por debajo del timeout de 12s — confirma que el timeout no introduce falsos negativos en el camino feliz.

---

## Archivos Tocados

Coincide 1:1 con las listas del plan (`git status --short`):

**Modificados (4):**
- `backend/src/services/tts/index.ts` — `withTimeout` + `TTS_SYNTH_TIMEOUT_MS`.
- `backend/src/services/tts/edge.ts` — timeout + descarte de cliente zombie + destroy del stream.
- `backend/src/services/tts/gemini.ts` — `AbortSignal.timeout` en el fetch.
- `backend/src/server.ts` — handler `process.on('unhandledRejection')`.

**Creados (2):**
- `backend/scripts/verify-unhandled-rejection.ts`.
- `backend/src/services/tts/tts.test.ts`.

Nada fuera de estas listas fue tocado. Los `.bak*`/`.tmpbak`/`.portbak` visibles en `git status` son residuos neutralizados de sesiones anteriores (no de este ticket), ya documentados como housekeeping pendiente.

---

## Tests Obligatorios — Mapeo

| Criterio del plan | Cobertura | Resultado |
|---|---|---|
| (a) Rejection flotante estilo msedge-tts NO mata el proceso | Script T03 + control negativo | PASS |
| (b) Síntesis colgada NO congela la entrevista: resuelve con fallback | `tts.test.ts` caso 3 (+ caso 4: cliente zombie descartado) | PASS |
| (c) Gemini TTS con error/lentitud degrada sin colgar | `AbortSignal.timeout` (T02) + catch existente (sin test dedicado nuevo: el catch ya estaba cubierto por el diseño previo; el `400` observado en producción ya caía al fallback antes de este ticket) | PASS (por diseño + build) |
| Regresión: TTS normal sigue funcionando | Suite completa 47/47 + smoke real T05 | PASS |

---

## Guardarraíles — Verificación de cumplimiento

- ✅ No se tocó `node_modules` ni se agregaron dependencias (`package.json`/`package-lock.json` sin cambios).
- ✅ La interfaz `TTSService`/`TTSResult` no cambió.
- ✅ `engine.ts`, `mock.ts`, `elevenlabs.ts` no fueron tocados.
- ✅ Solo se agregó handler de `unhandledRejection`; no se tocó `uncaughtException`.
- ✅ Cadena de fallbacks Gemini→Edge→Mock conservada tal cual (mismo orden, mismos catch existentes).

---

## Hallazgos Fuera de Alcance

Ninguno nuevo. La causa raíz del `400 INVALID_ARGUMENT` puntual de GeminiTTS (documentada como riesgo heredado R4 en el análisis del Arquitecto) sigue sin investigar — ahora es no-bloqueante gracias al timeout + fallback, pero si se quisiera usar Gemini TTS como driver principal en algún momento, valdría la pena investigarla en un ticket aparte.

---

## Pendientes

Ninguno para este ticket. Con esto, **FIX-TTS-ROBUSTEZ queda completo y verificado**.

---

## CHANGELOG

- v1.0 (2026-07-10): Ejecución inicial completa, sin desviaciones. 5/5 tareas COMPLETADA-VALIDADA.
