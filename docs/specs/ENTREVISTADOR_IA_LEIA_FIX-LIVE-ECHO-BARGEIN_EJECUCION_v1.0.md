# Informe de Ejecución — Fix eco en modo live: unificar AudioContext de captura y reproducción

## 0. Metadatos

- **ID Ticket:** FIX-LIVE-ECHO-BARGEIN
- **Versión del informe:** v1.1
- **Fecha:** 2026-07-07
- **Producido por:** Desarrollador SDD (skill desarrollador-sdd)
- **Plan ejecutado:** `ENTREVISTADOR_IA_LEIA_FIX-LIVE-ECHO-BARGEIN_PLAN_EJECUTOR_v1.0.md`
- **Análisis de referencia:** `ENTREVISTADOR_IA_LEIA_FIX-LIVE-ECHO-BARGEIN_ARQUITECTO_v1.0.md`
- **Branch de trabajo:** `feature/arnes-etapa-1-candidato` (commit de partida `e03411b` + scheduler gapless de TUNE-LIVE-AUDIO ya aplicado en el working tree, verificado antes de arrancar)
- **Estado global:** COMPLETA. Test 1 confirmado por el humano con evidencia de log (ver §4/§10): mejora clara y consistente respecto del baseline pre-fix.
- **Commit(s) resultantes:** `b1a027b` (TUNE-LIVE-AUDIO: engine.ts + docs), `7512415` (este ticket: page.tsx + docs)

---

## 1. Resumen Ejecutivo

- Se unificó el `AudioContext` de captura del micrófono del candidato con el de reproducción de leIA (`audioCtxRef`), eliminando el `AudioContext` propio a 16kHz que rompía la correlación de eco del navegador.
- Se agregó `resampleTo16kPCM()`, una función de resampleo por interpolación lineal que convierte del sample rate nativo del contexto compartido a 16kHz antes de enviar el PCM a Gemini Live.
- `stopCandidateAudioCapture()` ya no cierra un `AudioContext` (no le pertenece); ahora solo desconecta el `MediaStreamAudioSourceNode` y el `ScriptProcessorNode`.
- Verificación automatizada completa: builds limpios (backend y frontend), vitest 27/27.
- Smokes con navegador: regresión pipeline OK (saludo, subtítulo, cierre con 2 informes); smoke live OK (conexión, latencia 1072ms, sin errores de consola, cierre limpio sin fallback).
- **Re-test del humano confirmado:** en una sesión real de ~3 minutos (interview `4e2f58af-37de-4e09-aa5f-62301e71cf66`, 01:42:40–01:45:39), el log registró **8 eventos de barge-in** distribuidos a lo largo de toda la conversación (01:42:46, 01:43:41, 01:43:46, 01:44:10, 01:44:48, 01:44:54, 01:45:03, 01:45:29) — contra 1 solo evento en la sesión de referencia pre-fix (104s, ticket TUNE-LIVE-AUDIO). El humano confirmó verbalmente: *"mejoró bastante"*.

---

## 2. Estado por Tarea

| Tarea | Estado | Validación ejecutada | Resultado |
|---|---|---|---|
| T01 — Unificar AudioContext + resampleo en JS | COMPLETADA-VALIDADA | `npm run build --workspace=frontend`, smokes pipeline y live con preview | Build limpio; ambos modos funcionan sin errores de consola |
| T02 — Limpieza de `micCtxRef` | COMPLETADA-VALIDADA | `grep -n "micCtxRef" frontend/app/sala/[id]/page.tsx` → sin resultados | Confirmado: no quedan referencias a la ref eliminada |

---

## 3. Log de Desviaciones

Ninguna — el plan se ejecutó tal como estaba escrito. La base asumida (scheduler gapless de TUNE-LIVE-AUDIO en el working tree) se verificó presente antes de empezar.

---

## 4. Tests Obligatorios

| Test | Procedimiento | Resultado |
|---|---|---|
| 1 — Barge-in confiable (repetido varias veces) | Ejecutado por el humano con micrófono real (interview `4e2f58af-37de-4e09-aa5f-62301e71cf66`, ~3 min) | PASA — 8 eventos de barge-in registrados en el log a lo largo de la sesión (vs. 1 en la sesión de referencia pre-fix de duración similar), confirmado verbalmente por el humano ("mejoró bastante") |
| 2 — Regresión pipeline | Entrevista `browser` sin `voiceMode`, vía preview: saludo con subtítulo, sin errores de consola, hangup → `completada` con 2 informes | PASA |
| 3 — Regresión smoke live (sin interrupción) | Entrevista `browser` con `voiceMode='live'`, vía preview: conexión a Gemini Live, latencia 1072ms, sin errores de consola, hangup → `completada` sin fallback | PASA |

---

## 5. Guion del re-test de barge-in (para el humano)

1. Crear entrevista `browser` con `voiceMode='live'` y abrir `/sala/:id` en un navegador con micrófono real (preferentemente con auriculares, para reducir eco acústico residual).
2. Consentir, unirse, esperar a que leIA esté a mitad de una pregunta.
3. Interrumpirla hablando por encima. **Repetir esto varias veces** durante la entrevista (no un único intento) para confirmar consistencia.
4. **Criterios:** (a) el log del backend muestra `voice-session: barge-in — audio interrumpido por el candidato` en CADA intento real de interrupción; (b) leIA cede el turno sin hablarte por encima.
5. Si el problema persiste (retardo, inconsistencia, o leIA sigue interrumpiendo), reportarlo como hallazgo nuevo — la siguiente escalada documentada por el Arquitecto (no implementada en este ticket) es enrutar la reproducción de leIA por un elemento `<audio>` HTML real.

---

## 6. Verificación Final

| Verificación | Comando | Resultado |
|---|---|---|
| Build backend | `npm run build --workspace=backend` | OK (exit 0) |
| Build frontend | `npm run build --workspace=frontend` | OK (exit 0) |
| Suite | `cd backend && npx vitest run` | 27/27 PASS |
| Smoke regresión pipeline | preview (ver §4 Test 2) | PASA |
| Smoke live sin interrupción | preview (ver §4 Test 3) | PASA |

---

## 7. Archivos Tocados

- **Modificados:**
  - `frontend/app/sala/[id]/page.tsx` — `startCandidateAudioCapture`/`stopCandidateAudioCapture` reescritas para compartir `audioCtxRef.current`; nueva función `resampleTo16kPCM`; ref `micCtxRef` reemplazada por `micSourceRef`.
- **Fuera de las listas del plan:** ninguno. (`backend/src/services/interview/engine.ts` figura modificado en `git status` por el log de `interrupted` de TUNE-LIVE-AUDIO, ya commiteable desde ese ticket anterior — no tocado en esta ejecución.)

---

## 8. Hallazgos Fuera de Alcance

Ninguno nuevo. El hallazgo que originó este ticket (§8 de TUNE-LIVE-AUDIO) queda resuelto en la medida en que el fix aplicado corrige la causa raíz identificada; su confirmación empírica queda en el Test 1 pendiente del humano.

---

## 9. Pendientes y Próximos Pasos

- [x] **Humano:** Test 1 (guion §5) — re-test de barge-in con micrófono real, repetido varias veces. Confirmado, ver §10.
- [ ] Si en uso futuro el eco vuelve a aparecer (ej. hardware sin auriculares, sala muy reverberante): escalar a D3 del análisis (routear audio de leIA por `<audio>` HTML) — requiere volver al Arquitecto, no implementar directo.
- [x] Commit de este ticket (junto con TUNE-LIVE-AUDIO): `b1a027b` y `7512415` en `feature/arnes-etapa-1-candidato`.

---

## 10. Evidencia del re-test (log crudo)

Sesión `4e2f58af-37de-4e09-aa5f-62301e71cf66`, ~3 minutos:

```
01:42:40.993 voice-session: conectado a Gemini Live
01:42:42.112 voice-session: latencia primer audio
01:42:46.933 voice-session: barge-in — audio interrumpido por el candidato
01:43:41.783 voice-session: barge-in — audio interrumpido por el candidato
01:43:46.882 voice-session: barge-in — audio interrumpido por el candidato
01:44:10.667 voice-session: barge-in — audio interrumpido por el candidato
01:44:48.219 voice-session: barge-in — audio interrumpido por el candidato
01:44:54.585 voice-session: barge-in — audio interrumpido por el candidato
01:45:03.529 voice-session: barge-in — audio interrumpido por el candidato
01:45:29.424 voice-session: barge-in — audio interrumpido por el candidato
01:45:39.140 voice-session: sesión Live cerrada
```

8 eventos en ~3 minutos de conversación activa, distribuidos con naturalidad a lo largo de toda la sesión (no agrupados al principio ni al final). Comparar con la sesión de referencia pre-fix (TUNE-LIVE-AUDIO §8/§10, interview `53774dc2-...`, 104s): 1 solo evento pese a intentos aparentes similares del candidato.

---

## CHANGELOG

- v1.1 (2026-07-07): Cerrado con el re-test del humano confirmado (8 eventos de barge-in en ~3 min, evidencia en §10) y los hashes de commit reales. Estado global: COMPLETA.
- v1.0 (2026-07-07): Ejecución inicial del plan v1.0. Estado global: COMPLETA CON PENDIENTE (Test 1 del humano, previsto por el plan). Tareas: 2/2 completadas-validadas. Sin desviaciones.
