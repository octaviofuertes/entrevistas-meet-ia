# Informe de Ejecución — Fix eco en modo live: unificar AudioContext de captura y reproducción

## 0. Metadatos

- **ID Ticket:** FIX-LIVE-ECHO-BARGEIN
- **Versión del informe:** v1.0
- **Fecha:** 2026-07-07
- **Producido por:** Desarrollador SDD (skill desarrollador-sdd)
- **Plan ejecutado:** `ENTREVISTADOR_IA_LEIA_FIX-LIVE-ECHO-BARGEIN_PLAN_EJECUTOR_v1.0.md`
- **Análisis de referencia:** `ENTREVISTADOR_IA_LEIA_FIX-LIVE-ECHO-BARGEIN_ARQUITECTO_v1.0.md`
- **Branch de trabajo:** `feature/arnes-etapa-1-candidato` (commit de partida `e03411b` + scheduler gapless de TUNE-LIVE-AUDIO ya aplicado en el working tree, verificado antes de arrancar)
- **Estado global:** COMPLETA CON PENDIENTE (Test 1 — barge-in confiable con micrófono real — queda para el humano, previsto así por el plan)
- **Commit(s) resultantes:** sin commitear — cambios en working tree

---

## 1. Resumen Ejecutivo

- Se unificó el `AudioContext` de captura del micrófono del candidato con el de reproducción de leIA (`audioCtxRef`), eliminando el `AudioContext` propio a 16kHz que rompía la correlación de eco del navegador.
- Se agregó `resampleTo16kPCM()`, una función de resampleo por interpolación lineal que convierte del sample rate nativo del contexto compartido a 16kHz antes de enviar el PCM a Gemini Live.
- `stopCandidateAudioCapture()` ya no cierra un `AudioContext` (no le pertenece); ahora solo desconecta el `MediaStreamAudioSourceNode` y el `ScriptProcessorNode`.
- Verificación automatizada completa: builds limpios (backend y frontend), vitest 27/27.
- Smokes con navegador: regresión pipeline OK (saludo, subtítulo, cierre con 2 informes); smoke live OK (conexión, latencia 1072ms, sin errores de consola, cierre limpio sin fallback).
- **Pendiente del humano:** re-test de barge-in con micrófono real, repetido varias veces (Test 1) — el criterio de éxito es consistencia, no un único intento aislado.

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
| 1 — Barge-in confiable (repetido varias veces) | Guion listo (ver §5); requiere micrófono real | PENDIENTE DEL HUMANO |
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

- [ ] **Humano:** Test 1 (guion §5) — re-test de barge-in con micrófono real, repetido varias veces.
- [ ] Si el Test 1 no mejora: escalar a D3 del análisis (routear audio de leIA por `<audio>` HTML) — requiere volver al Arquitecto, no implementar directo.
- [ ] Commit de este ticket (junto con TUNE-LIVE-AUDIO, ambos sobre el mismo working tree) en `feature/arnes-etapa-1-candidato`, esperando confirmación.

---

## CHANGELOG

- v1.0 (2026-07-07): Ejecución inicial del plan v1.0. Estado global: COMPLETA CON PENDIENTE (Test 1 del humano, previsto por el plan). Tareas: 2/2 completadas-validadas. Sin desviaciones.
