# Plan de Ejecución — Etapa 1, Ticket 03: Barge-in Real y Cadena de Fallback

## Metadatos

- **Ticket:** ETAPA1-03 (de 4)
- **Versión:** v1.0
- **Fecha:** 2026-07-06
- **Origen:** Análisis del Arquitecto SDD — ver `ENTREVISTADOR_IA_LEIA_ETAPA1_ARQUITECTO_v1.0.md` §3-4 y `SPIKE_LIVE_API_RESULTADOS_v1.1.md` (Test H2: barge-in detectado en 621ms con audio pausado a tiempo real).
- **Destinatario:** Agente Ejecutor (Codificador).
- **Base de código requerida:** branch `feature/arnes-etapa-1-candidato` con ETAPA1-02 completado y validado (`VoiceSession` conecta y saluda con audio real, latencia medida).
- **Stack y comandos:** igual que ETAPA1-02.
- **Alcance de esta tarea:** completar `VoiceSession` para sostener la **conversación completa** (no solo el saludo), agregar **captura de audio del candidato** (mic → PCM → `sendRealtimeInput`, pausado a tiempo real — nunca en ráfaga, confirmado como causa raíz de fallos en el spike), implementar **barge-in real**, y la **cadena de fallback** hacia el pipeline existente ante fallo de Live.

---

## Misión

Que una entrevista completa en modo `live` funcione de punta a punta: leIA hace todas sus preguntas por voz nativa de Gemini Live, el candidato puede interrumpirla hablando (barge-in), y si la conexión Live falla en cualquier momento, la entrevista continúa sin cortarse usando el pipeline TTS existente.

---

## Guardarraíles (No Negociables)

### Lo que NO se modifica
- El modo `pipeline` (comportamiento actual) sigue intacto para entrevistas sin `voiceMode='live'`.
- `leia.evaluate()` sigue siendo la única fuente de verdad para el contenido técnico de las respuestas — la transcripción de Live (`inputTranscription`) se usa SOLO para mostrar texto/registrar el turno, nunca para puntuar directamente (Decisión D3 del Arquitecto, confirmada en Spike 1 Test C: la transcripción de términos técnicos puede venir incompleta).
- El guard de half-duplex existente (`isBotSpeaking` / equivalente) — se debe caracterizar su comportamiento actual con un test ANTES de tocarlo (mismo patrón que T04 de la Etapa 0), porque el nuevo estado `interrupted` de Live puede solaparse con él (Riesgo R15).

### Convenciones a respetar
- Audio del candidato SIEMPRE pausado a tiempo real antes de enviarse (`sendRealtimeInput`), nunca en ráfaga — este es el hallazgo más importante y no negociable de los dos spikes: enviar en ráfaga rompe tanto la detección de barge-in como la calidad de transcripción de entrada.
- Mecanismo de envío: `sendRealtimeInput`, NUNCA `sendClientContent` para audio del candidato (el SDK documenta que `sendClientContent` no está optimizado para interrupciones).
- Fallback silencioso: ante cualquier error/cierre inesperado de la sesión Live, la entrevista debe seguir viva usando el pipeline existente — nunca debe tirar la sesión completa.

---

## Entorno de Ejecución

- Igual que ETAPA1-02. Verificación manual contra la API real de Gemini Live (mismo motivo: no hay mock viable de un WebSocket bidireccional de audio).

---

## Archivos a Modificar

1. `backend/src/services/voice/live-session.ts` — extender `VoiceSession`: método `sendCandidateAudio(pcmChunk: Buffer)`, manejo de `interrupted` en `onmessage`, cierre limpio, reconexión NO automática (si falla, se cae al fallback, no se reintenta Live en la misma entrevista — decisión de simplicidad, documentada).
2. `backend/src/services/voice/live-session.test.ts` — tests del pacing de audio saliente del candidato.
3. `backend/src/services/interview/engine.ts` — completar la rama `voiceMode==='live'` de `start()`: en vez de solo saludar, mantener la sesión abierta durante toda la entrevista, escuchar transcripciones de entrada/salida para reconstruir `interview_turns`, correr `leia.evaluate()` de forma asíncrona por turno (para scoring, no para decidir la siguiente pregunta — eso lo decide el propio modelo de Live vía su system prompt), detectar condiciones de cierre (piso/techo de turnos o tiempo límite ya existentes) e instruir a Live a cerrar cordialmente, y capturar errores de la sesión Live para activar el fallback.
4. `backend/src/realtime/browser-sala.ts` — en el handler de mensajes WS, aceptar un nuevo tipo `candidate_audio` (chunks PCM del mic del candidato) y reenviarlo a la instancia de `VoiceSession` de esa entrevista (si existe).
5. `frontend/app/sala/[id]/page.tsx` — agregar captura de audio del mic mientras la entrevista está en curso y `voiceMode==='live'`: usar `AudioContext` + `ScriptProcessorNode`/`AudioWorklet` (lo que ya haya de patrón en el archivo para captura de audio, si existe; si no, usar `MediaRecorder` con envío de chunks pequeños) para obtener PCM 16kHz mono y enviarlo por WS como `candidate_audio` en chunks pequeños (~100-200ms) — el pacing real ya lo garantiza el propio ritmo de captura en vivo, no hace falta simularlo del lado del cliente.

---

## Tareas (Orden Topológico)

### T01 — Caracterización del guard de half-duplex existente

**Qué hacer:** ANTES de tocar nada del ciclo de turnos, escribir un test que documente el comportamiento actual del guard que evita que el sistema procese audio del candidato mientras leIA está hablando (buscar `isBotSpeaking` o equivalente en `engine.ts`/`browser-sala.ts`). Si no existe un test de este comportamiento, crear uno en el archivo de test correspondiente (`engine.test.ts` si aplica) que falle si el guard se rompe.

**Criterio de validación:** `npx vitest run` — el nuevo test caracteriza el comportamiento ANTES del resto de los cambios de este ticket, y debe seguir pasando después de T04.

**Depende de:** Ninguna (puede arrancar en paralelo con ETAPA1-02 si el Ejecutor lo desea, pero por orden de partición se hace después).

---

### T02 — Captura de audio del candidato (frontend) y transporte (backend)

**Qué hacer:**
1. Frontend: agregar captura de mic → PCM 16kHz mono en chunks de ~100-200ms, activa solo cuando `voiceMode==='live'` y la entrevista está en curso. Enviar cada chunk por WS: `{type: 'candidate_audio', pcmBase64, seq}`.
2. Backend (`browser-sala.ts`): en el handler WS existente, agregar el caso `candidate_audio` → si existe una `VoiceSession` activa para esa entrevista, llamar `voiceSession.sendCandidateAudio(Buffer.from(pcmBase64, 'base64'))`. Si no existe (modo pipeline), ignorar el mensaje (no debe romper nada).

**Archivos:** `frontend/app/sala/[id]/page.tsx`, `backend/src/realtime/browser-sala.ts`.

**Criterio de validación:** smoke manual (ver Verificación Final) — observar en el log del backend que llegan chunks de `candidate_audio` mientras el candidato habla.

**Depende de:** T01, ETAPA1-02 completo.

---

### T03 — `VoiceSession.sendCandidateAudio` + manejo de `interrupted`

**Qué hacer:** en `live-session.ts`:
1. `sendCandidateAudio(pcmChunk: Buffer)`: llama `this.session.sendRealtimeInput({ audio: { data: pcmChunk.toString('base64'), mimeType: 'audio/pcm;rate=16000' } })`. Nada de buffering/pacing adicional acá — el pacing real ya viene garantizado porque el frontend envía chunks al ritmo real de captura (T02).
2. En el callback `onmessage`, manejar `serverContent.interrupted === true`: emitir un evento `onInterrupted` que el engine usa para cortar la reproducción de audio en curso del lado del frontend (reenviar un mensaje `{type:'stop_audio'}` por el bus existente, igual patrón que otros mensajes de control).
3. Manejar `serverContent.turnComplete` para saber cuándo Live terminó de "hablar" un turno y reconstruir el turno completo (input transcript + output transcript) para persistir en `interview_turns`.

**Archivos:** `backend/src/services/voice/live-session.ts`.

**Criterio de validación:** test unitario de la función de armado del mensaje `sendRealtimeInput` (formato correcto del payload) en `live-session.test.ts`; el resto se valida en el smoke manual.

**Depende de:** T02.

---

### T04 — Ciclo de turnos completo en modo Live + cadena de fallback

**Qué hacer:** en `engine.ts`, rama `voiceMode==='live'`:
1. Tras el saludo (ya implementado en ETAPA1-02), mantener la `VoiceSession` abierta y escuchando durante toda la duración de la entrevista.
2. Por cada `turnComplete` recibido (par pregunta-de-Live + respuesta-del-candidato reconstruido de las transcripciones), persistir un `interview_turn` (reutilizar `commitAnswer`/estructura existente) y disparar `leia.evaluate()` de forma asíncrona (fire-and-forget respecto del flujo conversacional de Live) solo para scoring — su resultado (`nextQuestion`) se descarta en modo `live` (Live decide su propia siguiente pregunta vía su propio razonamiento sobre el system prompt), pero sus `dimensions`/`flags`/`redFlags` sí se guardan como siempre.
3. Reutilizar las condiciones de cierre existentes (mínimo/máximo de turnos, límite de tiempo) — cuando se cumplen, enviar una instrucción de cierre a Live (`sendClientContent` con texto tipo "Es momento de cerrar la entrevista, agradecé y despedite brevemente") y, tras el siguiente `turnComplete`, cerrar la sesión y finalizar la entrevista con el flujo existente (sin cambios).
4. **Fallback:** en el callback `onError`/`onClose` inesperado de `VoiceSession` (antes de que la entrevista haya sido marcada como completa), cerrar la sesión Live y continuar la entrevista con el pipeline existente: tomar el `nextQuestion` de la última evaluación disponible (o, si no hay ninguna todavía, usar `leia.firstQuestion()`) y llamar al `askQuestion()` existente como si la entrevista siempre hubiera sido `pipeline` desde ese punto en adelante. Loguear con `logger.warn` la transición y marcar (campo nuevo o log estructurado, decisión menor del Ejecutor) que esta entrevista tuvo un fallback, para trazabilidad.

**Archivos:** `backend/src/services/interview/engine.ts`.

**Criterio de validación:** smoke manual (ver Verificación Final) cubriendo: (a) entrevista completa feliz en modo live, (b) barge-in real, (c) fallback simulado (cortar la red o matar la key temporalmente a mitad de entrevista, si es viable en el entorno de prueba — si no es viable, simular forzando un error en el callback vía un flag de test/debug documentado como tal).

**Depende de:** T03.

---

## Tests Obligatorios

### Test AC-NEW-03 — Barge-in real
**Dado:** una entrevista en curso en modo `live`, leIA está hablando (reproduciendo audio de una pregunta). **Cuando:** el candidato empieza a hablar (audio real capturado por el mic, no simulado). **Entonces:** dentro de ~1 segundo, el audio de leIA se corta (evento `stop_audio` recibido en frontend) y el sistema pasa a escuchar la respuesta del candidato.
**Cómo verificarlo:** smoke manual, hablando efectivamente por el mic mientras leIA está a mitad de una oración.

### Test AC-NEW-05 — Fallback ante fallo de Live
**Dado:** una entrevista en curso en modo `live`. **Cuando:** la sesión Live se cae (error de red, cierre inesperado del WS, o key inválida forzada). **Entonces:** la entrevista continúa con el pipeline TTS existente sin que el candidato pierda la sesión ni tenga que recargar.
**Cómo verificarlo:** smoke manual forzando el fallo (ver T04).

---

## Verificación Final

**Automáticas:**
1. `npm run build --workspace=backend` y `--workspace=frontend` → sin errores.
2. `cd backend && npx vitest run` → toda la suite pasa, incluyendo el test de caracterización de T01 y los nuevos de T03.

**Manual (smoke test, entrevista completa en modo `live`):**
1. Levantar todo el stack con `GEMINI_API_KEY` válida.
2. Crear entrevista `voiceMode='live'`, pasar lobby con consentimiento (ETAPA1-01).
3. leIA saluda (ya validado en ETAPA1-02) y hace su primera pregunta real por voz.
4. Responder normalmente por el mic — confirmar que se transcribe (aunque sea de forma imperfecta en términos técnicos, según lo documentado) y que la conversación avanza a la siguiente pregunta SIN intervención manual.
5. En algún punto, interrumpir a leIA hablando mientras ella está a mitad de una pregunta — confirmar que se corta y escucha.
6. Completar la entrevista hasta el cierre natural (mínimo de turnos alcanzado) — confirmar que cierra igual que en modo pipeline (mismo flujo de finalización, mismo informe generado).
7. Repetir una entrevista y forzar un fallo de Live a mitad de camino (desconectar red brevemente o similar) — confirmar que la entrevista sigue con voz del pipeline existente y llega a un cierre normal.
8. Confirmar que una entrevista en modo `pipeline` (sin tocar nada de esto) sigue funcionando exactamente igual que antes (regresión check).

---

## Qué Hacer al Terminar

1. Reportar archivos modificados, resultado de cada test (automático y manual), y explícitamente el resultado del smoke de fallback (paso 7) — es el criterio más difícil de verificar y el más importante de documentar con precisión (qué se forzó, qué se observó).
2. Cualquier ajuste al mecanismo de captura de audio del frontend (softobre APIs de navegador usadas) debe documentarse como desviación menor si difiere de lo sugerido en este plan.
3. NO hacer commit/push sin instrucción explícita.

---

## CHANGELOG

- v1.0 (2026-07-06): Versión inicial. Completa T06 (segunda mitad) y T07 del contrato de Cambios Propuestos.
