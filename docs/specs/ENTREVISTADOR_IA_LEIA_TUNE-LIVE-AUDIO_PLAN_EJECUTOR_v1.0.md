# Plan de Ejecución — Afinado de audio del modo live

## Metadatos

- **Ticket:** TUNE-LIVE-AUDIO
- **Versión:** v1.0
- **Fecha:** 2026-07-07
- **Origen:** `ENTREVISTADOR_IA_LEIA_TUNE-LIVE-AUDIO_ARQUITECTO_v1.0.md` (hallazgo de la primera entrevista real en modo live, síntoma confirmado `[USR]`).
- **Destinatario:** Agente Ejecutor (Codificador).
- **Base de código requerida:** branch `feature/arnes-etapa-1-candidato`, commit `e03411b` (verificada como HEAD al momento del análisis). Trabajar sobre el mismo branch.
- **Stack y comandos:** monorepo npm workspaces. Backend: `npm run build --workspace=backend`, `cd backend && npx vitest run`. Frontend: `npm run build --workspace=frontend`. Postgres local: `docker compose up -d postgres` (host **5433**). Auth API admin: `Authorization: Bearer admin-demo-token-cambiar`. `GEMINI_API_KEY` válida en `backend/.env` para el smoke live.

---

## Misión

Que la voz de leIA en modo `voiceMode='live'` se reproduzca sin huecos audibles (agendado gapless de los chunks streameados sobre el timeline del AudioContext), y que el evento de barge-in (`interrupted`) deje una línea de log en el backend para que su prueba manual sea verificable con evidencia.

---

## Guardarraíles (No Negociables)

- **NO tocar** `backend/src/services/voice/live-session.ts` (el bridge Live funciona; el log nuevo va en el callback del engine, no acá).
- **NO cambiar** el contrato de mensajes WS de la sala (`audio`, `stop_audio`, etc.) ni el formato WAV que emite el backend — el fix es de reproducción, no de transporte.
- **NO agregar** buffering/acumulación de audio en el backend (decisión D1 del Arquitecto: descartado por latencia).
- El comportamiento observable del modo `pipeline` debe mantenerse: mismos estados de UI (video talk/idle, barras de sonido, thinking dots), mic pausado mientras leIA habla (`stopListening`) y reanudado al terminar la cola (`startListening`), CC intactos.
- Sin dependencias nuevas.

---

## Entorno de Ejecución

- `docker compose up -d postgres` (queda en host 5433) + backend (`npx tsx src/server.ts` desde `backend/`) + frontend (`npm run dev --workspace=frontend`).
- Health check: `curl -H "Authorization: Bearer admin-demo-token-cambiar" http://localhost:4000/api/health` → `"status":"ok"`.
- El smoke live requiere `GEMINI_API_KEY` válida y navegador con micrófono real para el re-test de barge-in (ese paso es del humano; el resto lo puede ejecutar el agente).

---

## Archivos a Crear

Ninguno.

## Archivos a Modificar

1. `frontend/app/sala/[id]/page.tsx` — reemplazo del mecanismo de reproducción.
2. `backend/src/services/interview/engine.ts` — log en `onInterrupted`.

---

## Tareas (Orden Topológico)

### T01 — Scheduler gapless en el reproductor de la sala

**Qué hacer:** en `frontend/app/sala/[id]/page.tsx`, reemplazar el mecanismo actual de `playNext()`/`enqueueAudio()`/`currentSourceRef` (reproduce un chunk por vez y encadena con `setTimeout(playNext, 40)` tras `onended`) por un scheduler gapless:

1. **Refs nuevas** (reemplazan `audioQueueRef`/`playingRef`/`currentSourceRef`):
   - `decodeChainRef = useRef<Promise<void>>(Promise.resolve())` — cadena de decodificación en orden estricto de llegada.
   - `nextStartTimeRef = useRef(0)` — próximo instante libre del timeline del AudioContext.
   - `activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set())` — sources agendados/en reproducción.
2. **`enqueueAudio(mimeType, audioBase64)`** encadena en `decodeChainRef`:
   - base64 → ArrayBuffer → `await ctx.decodeAudioData(...)` (con try/catch: un chunk indecodificable se saltea sin romper la cadena).
   - Crear el source, conectarlo a `masterGainRef.current ?? ctx.destination`.
   - `const t = Math.max(ctx.currentTime + 0.02, nextStartTimeRef.current); source.start(t); nextStartTimeRef.current = t + buffer.duration;`
   - `activeSourcesRef.current.add(source)`; en `source.onended`: `delete` del set, y si el set quedó vacío → **drain** (ver punto 4).
   - Si es el primer source tras un drain (set estaba vacío antes de agregar): activar el estado "hablando" (mismo bloque que hoy: `leiaSpeakingRef/setLeiaSpeaking(true)`, `setLeiaThinking(false)`, `stopListeningRef.current()`, video talk visible / idle oculto).
3. **`stop_audio` (barge-in):** detener TODOS los sources del set (`try { s.stop() } catch {}` sobre cada uno), vaciar el set, resetear `nextStartTimeRef.current = 0`. La cadena de decode pendiente puede seguir agendando chunks viejos: invalidarla con un contador de generación (`generationRef`) que se incrementa en cada `stop_audio` — los pasos de la cadena capturan la generación al encolarse y no agendan si ya no es la vigente.
4. **Drain (cola vacía y cadena ociosa):** mismo bloque que el final actual de `playNext()` — `leiaSpeaking=false`, video idle visible, `startListeningRef.current()` si el mic está activo.
5. En `endCall()`: además de lo actual, detener los sources del set y vaciar la cadena (reemplaza el `audioQueueRef.current = []`).

**Criterio de validación:** `npm run build --workspace=frontend` sin errores. Validación funcional en T03.

**Depende de:** Ninguna.

---

### T02 — Log del evento `interrupted` en el engine

**Qué hacer:** en `backend/src/services/interview/engine.ts`, en el callback `onInterrupted` de la construcción de `VoiceSession` (rama `voiceMode === 'live'` de `start()`), que hoy solo hace `browserSalaBus.send(..., { type: 'stop_audio' })`, agregar antes del send:

```ts
logger.info({ interviewId: this.interviewId }, 'voice-session: barge-in — audio interrumpido por el candidato');
```

**Criterio de validación:** `npm run build --workspace=backend` sin errores.

**Depende de:** Ninguna (paralelizable con T01).

---

## Tests Obligatorios

### Test 1 — Playback continuo en modo live (síntoma reportado)
**Dado:** una entrevista `browser` con `voiceMode='live'` y `GEMINI_API_KEY` válida. **Cuando:** leIA saluda y hace preguntas. **Entonces:** su voz se escucha continua, sin tartamudeo ni huecos entre chunks.
**Cómo:** smoke manual (crear la entrevista vía `POST /api/interviews` con `{"mode":"browser","voiceMode":"live",...}`, abrir `/sala/:id`, consentir, unirse, escuchar el saludo completo y al menos 2 preguntas).

### Test 2 — Barge-in verificable
**Dado:** la misma entrevista live, leIA hablando. **Cuando:** el candidato habla por encima (micrófono real). **Entonces:** (a) el log del backend muestra `voice-session: barge-in — audio interrumpido por el candidato` con el interviewId, y (b) el audio de leIA se corta en <1s.
**Cómo:** manual del humano (requiere micrófono). El criterio (a) es el objetivo: convierte el test de memoria en test de evidencia. Si (a) aparece pero (b) no se percibe, o viceversa, reportarlo como hallazgo — no intentar arreglarlo en este ticket.

### Test 3 — Regresión del modo pipeline
**Dado:** una entrevista `browser` SIN `voiceMode='live'` (default pipeline). **Cuando:** transcurre normalmente. **Entonces:** leIA habla con el TTS de siempre, los estados de UI (talk/idle, barras, CC) funcionan, el mic se pausa mientras habla y se reanuda al terminar, y la entrevista llega a los informes.
**Cómo:** smoke manual (mismo flujo de siempre; puede ser corto: saludo + 1 respuesta + colgar).

---

## Verificación Final

**Automáticas:**
1. `npm run build --workspace=backend` → sin errores.
2. `npm run build --workspace=frontend` → sin errores.
3. `cd backend && npx vitest run` → 27/27 tests siguen pasando.

**Manual:**
4. Test 3 (regresión pipeline) — ejecutable por el agente con el navegador de preview.
5. Test 1 (playback live continuo) — ejecutable por el agente hasta donde el entorno lo permita (el audio no se "escucha" desde el preview; verificar como proxy que los chunks se agendan sin errores de consola y que los estados de UI transicionan bien; la percepción final del tartamudeo la confirma el humano).
6. Test 2 (barge-in) — **del humano**, con el criterio objetivo del log.

---

## Qué Hacer al Terminar

1. Reportar archivos modificados, resultado de cada verificación (real, no aspiracional), y dejar el guion del Test 2 listo para el humano.
2. NO hacer commit/push sin confirmación explícita.

---

## CHANGELOG

- v1.0 (2026-07-07): Versión inicial. Scheduler gapless (D1/D2/D3) + log de barge-in (D4).
