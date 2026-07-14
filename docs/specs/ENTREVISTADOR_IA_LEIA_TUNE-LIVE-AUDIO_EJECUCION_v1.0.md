# Informe de Ejecución — Afinado de audio del modo live

## 0. Metadatos

- **ID Ticket:** TUNE-LIVE-AUDIO
- **Versión del informe:** v1.1
- **Fecha:** 2026-07-07
- **Producido por:** Desarrollador SDD (skill desarrollador-sdd)
- **Plan ejecutado:** `ENTREVISTADOR_IA_LEIA_TUNE-LIVE-AUDIO_PLAN_EJECUTOR_v1.0.md`
- **Análisis de referencia:** `ENTREVISTADOR_IA_LEIA_TUNE-LIVE-AUDIO_ARQUITECTO_v1.0.md`
- **Branch de trabajo:** `feature/arnes-etapa-1-candidato` (commit de partida `e03411b`)
- **Estado global:** COMPLETA. Test 1 (audio continuo) confirmado `[USR]`. Test 2 (barge-in) ejecutado por el humano: el log capturó UN evento de `interrupted` en la sesión, pero la experiencia real reveló un problema distinto y más profundo que el ticket no cubría — ver Hallazgo Fuera de Alcance §8.
- **Commit(s) resultantes:** pendiente de confirmación

---

## 1. Resumen Ejecutivo

- El reproductor de la sala fue reemplazado por un **scheduler gapless**: los chunks se decodifican en orden estricto (cadena de promesas) y se agendan pegados sobre el timeline del AudioContext (`source.start(nextStartTime)`), eliminando el `setTimeout(40)` entre chunks que causaba el tartamudeo en modo live.
- `stop_audio` (barge-in) ahora frena **todos** los sources en vuelo y usa un contador de generación para descartar chunks que quedaron decodificándose — con agendado adelantado puede haber varios sources encolados.
- El evento `interrupted` de Live ahora deja línea de log en el backend (`voice-session: barge-in — audio interrumpido por el candidato`), convirtiendo el re-test de barge-in en verificable con evidencia.
- Verificación automatizada completa: builds limpios, vitest 27/27.
- Smokes con navegador: regresión pipeline OK (saludo multi-chunk por sentence-streaming reproducido y drenado, estados de UI correctos, cierre con 2 informes); smoke live OK hasta donde el entorno permite (sesión conectada, latencia 1686ms, chunks agendados sin errores de consola, drain correcto).
- **Confirmado por el humano:** el tartamudeo desapareció (Test 1) — el scheduler gapless resolvió el síntoma original del ticket.
- **Re-test de barge-in ejecutado:** en una sesión real de 104s, el log solo registró UN evento `interrupted`, pese a que el humano reportó haber intentado interrumpir a leIA varias veces, con retardo notorio, y que en un momento **leIA le habló por encima a él** (evidencia en el turno T4/T5 de la entrevista: el candidato dice textualmente "Sí, pero seguí hablando y no me escuchás"). Esto es un hallazgo nuevo, no cubierto por el alcance de este ticket (que solo agregaba el log, no cambiaba el mecanismo de barge-in) — ver §8.

---

## 2. Estado por Tarea

| Tarea | Estado | Validación ejecutada | Resultado |
|---|---|---|---|
| T01 — Scheduler gapless + stop_audio multi-source | COMPLETADA-VALIDADA | builds + smokes pipeline y live con preview | Sin errores de consola; estados speak/drain correctos en ambos modos |
| T02 — Log de `interrupted` | COMPLETADA-VALIDADA | `npm run build --workspace=backend` | Build limpio (la línea solo se dispara con barge-in real — ver Test 2) |

---

## 3. Log de Desviaciones

| # | Tarea | Tipo | Qué decía el plan | Qué se encontró | Qué se hizo |
|---|---|---|---|---|---|
| D1 | T01 | Menor | El plan no lo especificaba | El handler `ws.onmessage` captura callbacks por closure (patrón del archivo: refs estables tipo `enqueueRef`) | Se agregó `stopPlaybackRef` con el mismo patrón para que `stop_audio` use siempre la versión vigente de `stopPlayback` |
| D2 | T01 | Menor | `toggleMic` usaba `playingRef` (ref eliminada con el reproductor viejo) | — | Reemplazado por `leiaSpeakingRef` (mismo significado semántico: leIA está hablando) |
| D3 | Test 3 | Menor | "saludo + 1 respuesta + colgar" | `BrowserRecall` no implementa `simulateCandidateAnswer` (limitación preexistente; el preview no tiene micrófono para dictar una respuesta real) | El smoke cubrió saludo multi-chunk (el sentence-streaming del pipeline ejercitó la cadena con varios chunks consecutivos, incluyendo re-entradas tras drain) + colgar + informes. La "respuesta" no es inyectable en modo browser sin mic; queda cubierta por el uso real del humano |

---

## 4. Tests Obligatorios

| Test | Procedimiento | Resultado |
|---|---|---|
| 1 — Playback continuo en live | Entrevista live real vía preview + confirmación auditiva del humano | PASA — humano confirmó audio fluido, sin tartamudeo |
| 2 — Barge-in verificable | Entrevista real (interview `53774dc2-70ac-46ab-90f2-3b93f8e8f893`, sesión de 104s) con micrófono real del humano | PARCIAL: el log SÍ se disparó una vez (`01:14:27`, criterio (a) cumplido), pero el comportamiento real no fue el esperado — retardo notorio y leIA hablando por encima del candidato. El log cumplió su propósito (hacer el fenómeno observable); lo que reveló es un hallazgo nuevo fuera del alcance de este ticket (§8) |
| 3 — Regresión pipeline | Entrevista pipeline vía preview: saludo reproducido (multi-chunk por sentence-streaming), estados talk/idle y CC correctos, hangup → `completada` con 2 informes | PASA (con la limitación D3 sobre la respuesta simulada) |

---

## 5. Guion del re-test de barge-in (para el humano)

1. Crear entrevista `browser` con `voiceMode='live'` (POST `/api/interviews` con ese campo) y abrir `/sala/:id` en un navegador con micrófono.
2. Consentir, unirse, esperar a que leIA esté a mitad de una pregunta.
3. Hablarle por encima con una frase completa.
4. **Criterios:** (a) el log del backend muestra `voice-session: barge-in — audio interrumpido por el candidato` con el interviewId; (b) la voz de leIA se corta en menos de ~1 segundo. Si (a) sin (b) o viceversa: reportar como hallazgo nuevo (no intentar arreglar sobre la marcha).
5. De paso, confirmar que la voz de leIA ya no tartamudea (Test 1).

---

## 6. Verificación Final

| Verificación | Comando | Resultado |
|---|---|---|
| Build backend | `npm run build --workspace=backend` | OK (exit 0) |
| Build frontend | `npm run build --workspace=frontend` | OK (exit 0) |
| Suite | `cd backend && npx vitest run` | 27/27 PASS |
| Smoke regresión pipeline | preview (ver §4 Test 3) | PASA |
| Smoke live | preview (ver §4 Test 1) | PASA como proxy técnico |

---

## 7. Archivos Tocados

- **Modificados:**
  - `frontend/app/sala/[id]/page.tsx` — scheduler gapless (decodeChain + nextStartTime + set de sources + generación), `stop_audio` multi-source, `endCall` y `toggleMic` adaptados.
  - `backend/src/services/interview/engine.ts` — log en `onInterrupted`.
- **Fuera de las listas del plan:** ninguno.

---

## 8. Hallazgos Fuera de Alcance

- `BrowserRecall` no implementa `simulateCandidateAnswer` (solo el mock de Meet lo tiene), por lo que `POST /api/interviews/:id/simulate-answer` es un no-op silencioso en modo browser y responde `{ok:true}` igual. No afecta producción (la respuesta real llega por transcript/audio del candidato); afecta la testeabilidad automatizada del modo browser. Gestión sugerida: implementarlo vía `ingestCaption` en un ticket menor si se quiere smoke E2E automatizable.

- **Barge-in poco confiable + leIA hablando por encima del candidato (hallazgo mayor, reportado al desarrollador).** En el re-test manual (interview `53774dc2-70ac-46ab-90f2-3b93f8e8f893`), el humano reportó retardo notorio al interrumpir a leIA y que en un momento ella le habló por encima. El log solo registró UN evento `interrupted` en toda la sesión pese a varios intentos aparentes, y la transcripción del turno T5 muestra al candidato diciendo textualmente *"Sí, pero seguí hablando y no me escuchás"*. Hipótesis de causa raíz (no verificada con instrumentación, solo por inspección): el audio de salida de leIA se reproduce vía Web Audio API (`masterGain → ctx.destination`), no vía un elemento `<audio>`/`<video>` HTML; la cancelación de eco del navegador (`echoCancellation: true` en las constraints de `getUserMedia`) típicamente referencia audio de reproducción por esos elementos o el output por defecto, y podría no estar cancelando audio ruteado crudo por AudioContext. Si el micrófono capta la propia voz de leIA como si fuera habla del candidato, explicaría tanto el VAD de Live confundido (retardo/inconsistencia) como el modelo "no cediendo el turno" (cree que la conversación sigue). **No se investigó ni se corrigió en este ticket** — es un hallazgo de arquitectura (cómo evitar el eco: ¿enrutar la reproducción por un elemento HTML real para que el AEC lo referencie? ¿gate de software tipo `isBotSpeaking()` aplicado también a la captura de audio del candidato en modo live?), no un ajuste de una línea. Gestión sugerida: análisis del Arquitecto con esta evidencia.

---

## 9. Pendientes y Próximos Pasos

- [x] **Humano:** Test 1 de oído — confirmado, audio fluido.
- [x] **Humano:** Test 2 (guion §5) — ejecutado; reveló el hallazgo de §8, no un resultado limpio.
- [ ] Análisis del Arquitecto para el hallazgo de eco/barge-in (§8) — en curso, ticket separado.
- [ ] Commit de este ticket en `feature/arnes-etapa-1-candidato`, esperando confirmación.

---

## CHANGELOG

- v1.1 (2026-07-07): Cerrado con los resultados reales del humano. Test 1 PASA (confirmado). Test 2 PARCIAL: el log cumplió su propósito pero reveló un hallazgo mayor (eco/AEC probable) documentado en §8, derivado a un ticket nuevo del Arquitecto. Estado global: COMPLETA.
- v1.0 (2026-07-07): Ejecución inicial del plan v1.0. Estado global: COMPLETA CON PENDIENTES (percepción de audio y barge-in del humano, previstos por el plan). Tareas: 2/2 completadas-validadas. Desviaciones: 3 menores.
