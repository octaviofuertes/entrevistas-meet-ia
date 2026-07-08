# Plan de Ejecución — Fix eco en modo live: unificar AudioContext de captura y reproducción

## Metadatos

- **Ticket:** FIX-LIVE-ECHO-BARGEIN
- **Versión:** v1.0
- **Fecha:** 2026-07-07
- **Origen:** `ENTREVISTADOR_IA_LEIA_FIX-LIVE-ECHO-BARGEIN_ARQUITECTO_v1.0.md` (hallazgo de la primera entrevista real en modo live: barge-in poco confiable, leIA interrumpiendo al candidato).
- **Destinatario:** Agente Ejecutor (Codificador).
- **Base de código requerida:** branch `feature/arnes-etapa-1-candidato`, commit `e03411b`, MÁS el scheduler gapless de TUNE-LIVE-AUDIO ya aplicado en el working tree sobre `frontend/app/sala/[id]/page.tsx` y `backend/src/services/interview/engine.ts` (no commiteado todavía). Si al arrancar ese working tree no está en ese estado (por ejemplo, si ya se commiteó o se perdió), es un bloqueante — reportar antes de seguir, no reconstruir el scheduler desde cero.
- **Stack y comandos:** monorepo npm workspaces. Backend: `npm run build --workspace=backend`, `cd backend && npx vitest run`. Frontend: `npm run build --workspace=frontend`. Postgres local: `docker compose up -d postgres` (host **5433**). Auth API admin: `Authorization: Bearer admin-demo-token-cambiar`. `GEMINI_API_KEY` válida en `backend/.env` para el smoke live.

---

## Misión

Que el candidato y leIA compartan un único `AudioContext` (el mismo que ya reproduce la voz de leIA) para la captura de micrófono en modo `voiceMode='live'`, eliminando el `AudioContext` separado a 16kHz que rompe la correlación de eco del navegador, resampleando en JavaScript en vez de forzar una tasa de contexto distinta.

---

## Guardarraíles (No Negociables)

- **NO tocar** el backend (`backend/src/services/voice/live-session.ts`, `backend/src/realtime/browser-sala.ts`, `backend/src/services/interview/engine.ts`) — el contrato de `candidate_audio` (PCM 16-bit LE 16kHz mono, base64) no cambia, solo cómo se genera en el frontend.
- **NO implementar** ningún gate que corte o silencie el envío de `candidate_audio` mientras leIA habla — fue evaluado y rechazado explícitamente (rompe el barge-in real, que depende de audio continuo para que Gemini Live detecte la interrupción).
- **NO tocar** el scheduler gapless de reproducción (`enqueueAudio`, `enterSpeakingUI`, `drainPlayback`, `stopPlayback`) — el fix es sobre la CAPTURA del micrófono, no la reproducción.
- **NO agregar** dependencias nuevas — el resampleo se implementa a mano (interpolación lineal).
- El modo `pipeline` (sin `voiceMode='live'`) no usa captura de audio crudo — no debe verse afectado por este cambio en absoluto.

---

## Entorno de Ejecución

- `docker compose up -d postgres` (host 5433) + backend (`npx tsx src/server.ts` desde `backend/`) + frontend (`npm run dev --workspace=frontend`).
- Health check: `curl -H "Authorization: Bearer admin-demo-token-cambiar" http://localhost:4000/api/health` → `"status":"ok"`.
- El smoke live y el re-test de barge-in requieren `GEMINI_API_KEY` válida y navegador con micrófono real (ese paso final es del humano).

---

## Archivos a Crear

Ninguno.

## Archivos a Modificar

1. `frontend/app/sala/[id]/page.tsx`

---

## Tareas (Orden Topológico)

### T01 — Unificar el AudioContext de captura con el de reproducción + resampleo en JS

**Qué hacer:** en `frontend/app/sala/[id]/page.tsx`:

1. Reemplazar la ref `micCtxRef` (un `AudioContext` propio) por `micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)` (para poder desconectar el nodo en el cleanup, ya que el contexto ahora es compartido y no le pertenece a esta función).

2. Reescribir `startCandidateAudioCapture(stream: MediaStream)`:
   - Ya NO crea un `AudioContext` propio. Usa `const ctx = audioCtxRef.current; if (!ctx) return;` (el mismo contexto que ya reproduce la voz de leIA, creado en `joinCall()` antes de llamar a esta función).
   - `const source = ctx.createMediaStreamSource(stream);` — guardar en `micSourceRef.current`.
   - `const processor = ctx.createScriptProcessor(4096, 1, 1);` (igual que antes, ahora sobre `ctx`).
   - `const silentGain = ctx.createGain(); silentGain.gain.value = 0;` (igual que antes).
   - En `processor.onaudioprocess`: donde antes se armaba el PCM16 directo desde `input` (asumiendo ya 16kHz porque `micCtx` lo forzaba), ahora `ctx.sampleRate` puede ser distinto de 16000 (típicamente 44100 o 48000) — resamplear `input` a 16kHz ANTES de convertir a Int16, usando la función del punto 3.
   - Conectar igual que antes: `source.connect(processor); processor.connect(silentGain); silentGain.connect(ctx.destination);`.

3. Agregar una función pura de resampleo (fuera del componente, o como función auxiliar del archivo — seguir la convención de otras funciones auxiliares ya presentes en el archivo):
   ```ts
   function resampleTo16kPCM(input: Float32Array, fromSampleRate: number): Int16Array {
     if (fromSampleRate === 16000) {
       const out = new Int16Array(input.length);
       for (let i = 0; i < input.length; i++) {
         const s = Math.max(-1, Math.min(1, input[i]));
         out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
       }
       return out;
     }
     const ratio = fromSampleRate / 16000;
     const outLength = Math.floor(input.length / ratio);
     const out = new Int16Array(outLength);
     for (let i = 0; i < outLength; i++) {
       const srcIndex = i * ratio;
       const i0 = Math.floor(srcIndex);
       const i1 = Math.min(i0 + 1, input.length - 1);
       const frac = srcIndex - i0;
       const sample = input[i0] * (1 - frac) + input[i1] * frac;
       const s = Math.max(-1, Math.min(1, sample));
       out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
     }
     return out;
   }
   ```
   (El Ejecutor puede ajustar el nombre/forma exacta si el estilo del archivo lo sugiere, siempre que la lógica de resampleo e clamping sea equivalente.)

4. Reescribir `stopCandidateAudioCapture()`:
   - Ya NO cierra un `AudioContext` (no es dueño de ninguno).
   - `micProcessorRef.current?.disconnect(); micProcessorRef.current = null;`
   - `micSourceRef.current?.disconnect(); micSourceRef.current = null;`

5. Actualizar el comentario que precede a `startCandidateAudioCapture` (hoy dice "PCM 16-bit LE 16kHz mono, pausado a tiempo real...") para reflejar que ahora se resamplea desde la tasa nativa del contexto compartido, en vez de forzar un contexto a 16kHz.

**Archivos:** `frontend/app/sala/[id]/page.tsx`.

**Criterio de validación:** `npm run build --workspace=frontend` sin errores. Validación funcional en T03.

**Depende de:** Ninguna.

---

### T02 — Limpieza de la ref obsoleta

**Qué hacer:** confirmar que `micCtxRef` no queda referenciada en ningún otro lugar del archivo tras T01 (búsqueda simple de texto) y que la nueva `micSourceRef` está declarada junto a `micProcessorRef` (misma sección de refs de captura de audio).

**Criterio de validación:** `grep -n "micCtxRef" frontend/app/sala/[id]/page.tsx` no debe devolver resultados. `npm run build --workspace=frontend` sin errores.

**Depende de:** T01.

---

## Tests Obligatorios

### Test 1 — Barge-in confiable (síntoma reportado)
**Dado:** una entrevista `browser` con `voiceMode='live'` y `GEMINI_API_KEY` válida, leIA hablando. **Cuando:** el candidato la interrumpe hablando por encima (micrófono real, preferentemente con auriculares para reducir eco acústico residual — ver nota operativa D4 del análisis). **Entonces:** el log del backend muestra `voice-session: barge-in — audio interrumpido por el candidato` de forma consistente con cada intento real de interrupción (no solo ocasionalmente), y leIA cede el turno sin hablar por encima del candidato.
**Cómo:** manual del humano — requiere micrófono real, no es automatizable desde este entorno.

### Test 2 — Regresión del modo pipeline
**Dado:** una entrevista `browser` SIN `voiceMode='live'`. **Cuando:** transcurre normalmente. **Entonces:** funciona exactamente igual que antes (este modo no usa `startCandidateAudioCapture` en absoluto — el cambio no debería tener ningún efecto observable).
**Cómo:** smoke manual, ejecutable por el agente con el navegador de preview.

### Test 3 — Regresión del smoke live ya cubierto por TUNE-LIVE-AUDIO
**Dado:** una entrevista `browser` con `voiceMode='live'`. **Cuando:** leIA saluda y hace preguntas (sin que el candidato la interrumpa). **Entonces:** el audio sigue reproduciéndose fluido (el scheduler gapless no se tocó) y la conexión se sostiene estable.
**Cómo:** smoke manual, ejecutable por el agente hasta donde el entorno de preview lo permita (sin percepción auditiva real).

---

## Verificación Final

**Automáticas:**
1. `npm run build --workspace=backend` → sin errores (no debería haber cambios en este workspace, pero confirmar que sigue compilando).
2. `npm run build --workspace=frontend` → sin errores.
3. `cd backend && npx vitest run` → 27/27 tests siguen pasando.

**Manual:**
4. Test 2 (regresión pipeline) — ejecutable por el agente con el navegador de preview.
5. Test 3 (smoke live sin interrupción) — ejecutable por el agente hasta donde el entorno lo permita.
6. Test 1 (barge-in confiable) — **del humano**, con micrófono real. Repetir la interrupción varias veces (no una sola vez) para confirmar consistencia, no solo un caso aislado.

---

## Qué Hacer al Terminar

1. Reportar archivos modificados, resultado de cada verificación (real, no aspiracional), y dejar el guion del Test 1 listo para el humano.
2. Si el Test 1 del humano sigue mostrando eco/interrupciones inconsistentes tras este fix, documentarlo como hallazgo nuevo y recomendar la escalada a D3 del análisis (routear la reproducción por un elemento `<audio>`) — no intentar implementarla en este pase sin volver al Arquitecto.
3. NO hacer commit/push sin confirmación explícita.

---

## CHANGELOG

- v1.0 (2026-07-07): Versión inicial. Unifica el AudioContext de captura y reproducción (D1) para restaurar la correlación de eco del navegador.
