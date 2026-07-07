# Plan de Ejecución — Etapa 1, Ticket 02: Conexión Básica a Gemini Live

## Metadatos

- **Ticket:** ETAPA1-02 (de 4)
- **Versión:** v1.0
- **Fecha:** 2026-07-06
- **Origen:** Análisis del Arquitecto SDD — ver `ENTREVISTADOR_IA_LEIA_ETAPA1_ARQUITECTO_v1.0.md` §3-4 y el veredicto D1' en `SPIKE_LIVE_API_RESULTADOS_v1.1.md`.
- **Destinatario:** Agente Ejecutor (Codificador).
- **Base de código requerida:** branch `feature/arnes-etapa-1-candidato` con ETAPA1-01 completado y validado (columnas de consentimiento presentes).
- **Stack y comandos:** igual que ETAPA1-01. Además: `GEMINI_API_KEY` de tier pago en `.env`/`backend/.env` (ya usada en el spike de la Etapa 0 — reutilizar la misma).
- **Alcance de esta tarea (importante, léelo antes de empezar):** este ticket prueba la conexión de punta a punta con el **saludo inicial únicamente** (leIA se conecta a Gemini Live y dice su presentación con voz real). **La conversación completa (turnos siguientes, barge-in, fallback ante fallo) es el ticket ETAPA1-03, NO este.** Es esperado y correcto que, al terminar este ticket, la entrevista no avance más allá del saludo en modo `live` — no es un bug a resolver acá.

---

## Misión

Implementar `VoiceSession`, un driver nuevo que conecta al Gemini Live API (`gemini-2.5-flash-native-audio-latest`, `thinkingConfig.thinkingBudget=0`) y hace que leIA salude al candidato con voz generada en tiempo real por el modelo, midiendo la latencia, sin romper el camino existente (pipeline TTS) cuando el modo de voz de la entrevista es el de siempre.

---

## Guardarraíles (No Negociables)

### Lo que NO se modifica
- El comportamiento del modo `pipeline` (el actual, sin cambios) para entrevistas que no usen `voiceMode='live'`.
- El ciclo de turnos existente del engine (`askQuestion`, `commitAnswer`, `armSilenceTimer`, guards) — no se toca su lógica interna en este ticket; `VoiceSession` es un componente nuevo que se agrega, no reemplaza nada todavía.
- La UI de la fase `running` de `frontend/app/sala/[id]/page.tsx` salvo el punto explícito de esta tarea (mostrar audio de Live vía el mismo mecanismo `enqueueAudio` existente).

### Convenciones a respetar
- Patrón factory + fallback silencioso ante error, igual que `services/leia/index.ts` y `services/tts/gemini.ts` (try/catch, log warn, no tirar la entrevista).
- `@google/genai` pasa de `devDependencies` a `dependencies` en `backend/package.json`, con versión **exacta** (sin `^`): `"@google/genai": "2.10.0"`.
- El WAV-wrapping de audio PCM debe reutilizar la función `pcmToWav` de `backend/src/services/tts/gemini.ts` (exportarla, no duplicar lógica).
- Logging con el logger pino existente, mensajes en español.

### Constraints técnicas
- Modelo: `gemini-2.5-flash-native-audio-latest` (confirmado en el spike; NO usar `gemini-live-2.5-flash-preview`, no está disponible para esta key).
- `thinkingConfig: { thinkingBudget: 0 }` es obligatorio en la config de conexión (sin esto la latencia es ~4.7s en vez de ~1.3s, confirmado en el spike).
- El audio que Live devuelve es PCM 16-bit a 24kHz (`audio/pcm;rate=24000`) — el frontend (`ctx.decodeAudioData`) necesita un archivo con header (WAV), no PCM crudo.

---

## Entorno de Ejecución

- Igual que ETAPA1-01 (Postgres + backend + frontend locales).
- Requiere `GEMINI_API_KEY` de tier pago válida en `backend/.env`.
- Sin mocks de Live API para la verificación manual (se prueba contra la API real, como en el spike) — no hay forma barata de mockear un WebSocket bidireccional de audio; el criterio de aceptación es observar el resultado real.

---

## Archivos a Crear

1. `backend/src/services/voice/live-session.ts` — clase `VoiceSession`.
2. `backend/src/services/voice/live-session.test.ts` — tests de las funciones puras (pacing, construcción de config).

## Archivos a Modificar

1. `backend/package.json` — mover `@google/genai` a `dependencies`, versión exacta `2.10.0`.
2. `backend/src/services/tts/gemini.ts` — exportar `pcmToWav` (agregar `export` antes de `function pcmToWav`).
3. `backend/src/types.ts` — `Interview.voiceMode?: 'live' | 'pipeline'` (default lógico `'pipeline'` si no está seteado).
4. `frontend/lib/types.ts` — espejo.
5. `backend/src/db/schema.sql` + `backend/src/db/postgres.ts` — columna `interviews.voice_mode TEXT NOT NULL DEFAULT 'pipeline' CHECK (voice_mode IN ('live','pipeline'))`, patrón idempotente ya usado 3 veces.
6. `backend/src/services/interview/engine.ts` — en `start()`, si `iv.mode === 'browser' && iv.voiceMode === 'live'`, instanciar `VoiceSession` y usarla SOLO para el saludo inicial (reemplaza el `askQuestion(intro)` de la rama browser existente, línea ~140, por una llamada a `voiceSession.speakGreeting(...)`); si `voiceMode !== 'live'` o no está seteado, el camino existente sigue intacto sin cambios.
7. `frontend/app/sala/[id]/page.tsx` — ninguna modificación funcional necesaria (el mensaje `audio` que ya maneja `enqueueAudio` sirve igual para audio proveniente de Live, siempre que venga con `mimeType: 'audio/wav'`).

---

## Tareas (Orden Topológico)

### T01 — Dependencia y export de `pcmToWav`

**Qué hacer:**
1. En `backend/package.json`, mover `"@google/genai": "^2.10.0"` de `devDependencies` a `dependencies`, cambiando a `"2.10.0"` (sin caret).
2. En `backend/src/services/tts/gemini.ts`, cambiar `function pcmToWav(...)` a `export function pcmToWav(...)` (sin otro cambio).
3. `npm install` (raíz) para que el lockfile refleje el movimiento de dependencia.

**Criterio de validación:**
```bash
npm run build --workspace=backend   # sin errores (confirma que pcmToWav es importable)
grep -A2 '"dependencies"' backend/package.json | grep genai   # debe aparecer ahí, no en devDependencies
```

**Depende de:** Ninguna.

---

### T02 — Columna `voice_mode` y tipos

**Qué hacer:** igual patrón que `mode`/`tts_driver` de la Etapa 0:
```sql
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS voice_mode TEXT NOT NULL DEFAULT 'pipeline';
```
más bloque `DO $$` con constraint `chk_interviews_voice_mode CHECK (voice_mode IN ('live','pipeline'))`. Agregar `voiceMode` a `Interview` (backend y frontend types) y al mapping de `postgres.ts` (`createInterview`/`updateInterview`/`rowToInterview`), default `'pipeline'` si viene `null`/`undefined`.

**Archivos:** `backend/src/db/schema.sql`, `backend/src/db/postgres.ts`, `backend/src/types.ts`, `frontend/lib/types.ts`.

**Criterio de validación:**
```bash
npm run build --workspace=backend
docker exec entrevistas-postgres psql -U entrevistas -d entrevistas -c "\d interviews" | grep voice_mode
```

**Depende de:** T01.

---

### T03 — `VoiceSession`: conexión + saludo + medición de latencia

**Qué hacer:** crear `backend/src/services/voice/live-session.ts`:
```ts
import { GoogleGenAI, Modality } from '@google/genai';
import { pcmToWav } from '../tts/gemini';
import { config } from '../../config';
import { logger } from '../../logger';
import type { Job, Candidate } from '../../types';

const MODEL = 'gemini-2.5-flash-native-audio-latest';

export interface VoiceSessionEvents {
  onAudio: (wavBase64: string, durationMs: number) => void;
  onOutputTranscript: (text: string) => void;
  onError: (err: Error) => void;
  onClose: (code?: number, reason?: string) => void;
}

export class VoiceSession {
  private session: any;
  private events: VoiceSessionEvents;

  constructor(events: VoiceSessionEvents) { this.events = events; }

  async connectAndGreet(job: Job, candidate: Candidate): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
    const systemInstruction = buildLiveSystemPrompt(job, candidate); // ver abajo
    const sentAt = Date.now();
    let firstAudioAt = 0;

    this.session = await ai.live.connect({
      model: MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction,
        outputAudioTranscription: {},
        thinkingConfig: { thinkingBudget: 0 },
      },
      callbacks: {
        onopen: () => logger.info('VoiceSession: conectado'),
        onmessage: (msg: any) => {
          const sc = msg.serverContent;
          if (sc?.modelTurn?.parts) {
            for (const p of sc.modelTurn.parts) {
              if (p.inlineData?.data) {
                if (!firstAudioAt) {
                  firstAudioAt = Date.now();
                  logger.info({ latencyMs: firstAudioAt - sentAt }, 'VoiceSession: latencia primer audio');
                }
                const pcm = Buffer.from(p.inlineData.data, 'base64');
                const wav = pcmToWav(pcm, 24000);
                const words = 10; // estimación mínima, no crítico para este ticket
                this.events.onAudio(wav.toString('base64'), Math.max(800, pcm.length / 48));
              }
            }
          }
          if (sc?.outputTranscription?.text) this.events.onOutputTranscript(sc.outputTranscription.text);
        },
        onerror: (e: any) => this.events.onError(new Error(e?.message ?? String(e))),
        onclose: (e: any) => this.events.onClose(e?.code, e?.reason),
      },
    });

    this.session.sendClientContent({
      turns: `Saludá a ${candidate.name} y presentate como leIA para la entrevista de ${job.title} en ${job.company}.`,
      turnComplete: true,
    });
  }

  close() { try { this.session?.close(); } catch { /* noop */ } }
}

function buildLiveSystemPrompt(job: Job, candidate: Candidate): string {
  return `Sos leIA, entrevistadora virtual con personalidad propia. Hablás español rioplatense con voseo natural, tono ${job.preferences.toneOfVoice}. Vas a entrevistar a ${candidate.name} para el puesto de ${job.title} en ${job.company}. Por ahora, SOLO saludá brevemente (2-3 oraciones) y presentate — no hagas preguntas todavía.`;
}
```
(El código de arriba es una guía de forma, no literal — el Ejecutor puede ajustar nombres/estructura interna siempre que cumpla la interfaz `VoiceSessionEvents` y el criterio de validación.)

**Archivos:** `backend/src/services/voice/live-session.ts`.

**Criterio de validación:** ver T05 (integración) — este archivo por sí solo se valida con el test unitario de T04 más la verificación manual de T05.

**Depende de:** T02.

---

### T04 — Tests de las funciones puras

**Qué hacer:** en `backend/src/services/voice/live-session.test.ts`, testear (sin llamar a la API real):
1. `buildLiveSystemPrompt` (si se extrae como función exportada, o cualquier función pura equivalente que arme el system prompt) — dado un `Job`/`Candidate` de ejemplo, el string contiene el nombre del candidato y el título del puesto.
2. Si se extrae una función de pacing de audio (reutilizada de T03 de este ticket o preparada para ETAPA1-03), testear que calcula correctamente ms por chunk a partir de bytes y sample rate (16000 Hz → 32000 bytes/seg).

**Archivos:** `backend/src/services/voice/live-session.test.ts`.

**Criterio de validación:**
```bash
cd backend && npx vitest run
# → todos los tests pasan, incluidos los nuevos (el conteo total sube de 21 a ~23-24)
```

**Depende de:** T03.

---

### T05 — Integración en `InterviewEngine`

**Qué hacer:** en `backend/src/services/interview/engine.ts`, dentro de `start()`, rama `if (isBrowser)` (línea ~119-140):
1. Leer `iv.voiceMode` (ya disponible en `this.interview`/`iv`).
2. Si `iv.voiceMode === 'live'`: en lugar de `await this.askQuestion(intro)` (línea 140), instanciar `VoiceSession` con callbacks que:
   - `onAudio`: reenvíe el audio al `browserSalaBus` con el mismo tipo de mensaje `audio` que ya usa `BrowserRecall.playAudio` (reutilizar `botStageBus`/`browserSalaBus.send` con `{type:'audio', mimeType:'audio/wav', audioBase64, durationMs}`).
   - `onOutputTranscript`: loguear (no hace falta persistir como turno todavía en este ticket — eso es ETAPA1-03).
   - `onError`/`onClose`: loguear con `logger.warn`; NO intentar fallback automático todavía (eso es ETAPA1-03) — simplemente que la entrevista no se rompa (no debe tirar una excepción no capturada).
   - Llamar `voiceSession.connectAndGreet(this.job, this.candidate)`.
3. Si `iv.voiceMode !== 'live'` (o no está seteado): comportamiento **exactamente igual al actual**, sin ninguna rama nueva ejecutándose.

**Archivos:** `backend/src/services/interview/engine.ts`.

**Criterio de validación:** ver Verificación Final (smoke manual — no hay forma de automatizar una llamada real a Gemini Live dentro de este plan sin gastar cuota en cada corrida de CI; se documenta como manual).

**Depende de:** T03.

---

## Tests Obligatorios

### Test AC-NEW-04 (parcial — latencia) — Medición real
**Dado:** una entrevista `browser` con `voiceMode='live'`. **Cuando:** arranca la entrevista. **Entonces:** el log muestra `VoiceSession: latencia primer audio` con un valor medido; se espera un valor cercano a los ~1.3s del spike (no es un assert automatizado — es una observación del smoke test, documentada).
**Implementación esperada:** log estructurado ya incluido en T03; observado en el smoke manual.

*(El resto de los AC de T06 — barge-in AC-NEW-03, fallback AC-NEW-05 — son de ETAPA1-03, no de este ticket.)*

---

## Verificación Final

**Automáticas:**
1. `npm run build --workspace=backend` → sin errores.
2. `cd backend && npx vitest run` → toda la suite pasa (21 + los nuevos de T04).
3. `npm run build --workspace=frontend` → sin errores (no debería haber cambios funcionales de frontend en este ticket).

**Manual (smoke test):**
1. Levantar Postgres + backend + frontend, con `GEMINI_API_KEY` válida en `backend/.env`.
2. Crear una entrevista `mode=browser` y, vía `PATCH` directo a la BD o un endpoint temporal si hace falta (**si no existe forma de setear `voiceMode` desde la API todavía, agregarla como parte de `PATCH /api/interviews/:id/tts` extendido, o un nuevo campo en el body de creación — decisión menor del Ejecutor, documentar como desviación menor si se toma**), setear `voiceMode='live'`.
3. Abrir la sala (`/sala/:id`), pasar el lobby (con el consentimiento de ETAPA1-01).
4. **Observar:** leIA saluda con voz real (generada por Gemini Live, no por el pipeline Edge/Gemini TTS de siempre) — se nota porque el tono/cadencia es distinto y porque el log del backend muestra la latencia medida.
5. **Confirmar que el avatar reacciona:** mientras suena el audio de Live, el avatar debe mostrar el estado "hablando" (video `talk`, barras de sonido) igual que con el pipeline existente — si no reacciona, es un defecto a corregir en este ticket (el mecanismo de `enqueueAudio`/`playNext` del frontend no distingue el origen del audio, así que debería funcionar sin cambios; si no funciona, revisar el `mimeType` enviado).
6. Repetir sin `voiceMode='live'` (o con el default) → comportamiento idéntico al de antes de este ticket (regresión check).

Documentar en el reporte si `voiceMode` no tenía forma de setearse desde la API y qué solución mínima se aplicó.

---

## Qué Hacer al Terminar

1. Reportar archivos creados/modificados, resultado de cada verificación, latencia observada en el smoke test, y cualquier desviación.
2. NO hacer commit/push sin instrucción explícita.
3. Aclarar explícitamente en el reporte que la conversación completa (turnos siguientes, barge-in, fallback) queda para ETAPA1-03 — no es un pendiente de este ticket, es alcance del siguiente.

---

## CHANGELOG

- v1.0 (2026-07-06): Versión inicial. Cubre la primera mitad de T06 del contrato (conexión + saludo + latencia). El resto de T06 (barge-in, integración completa del ciclo de turnos) y T07 (fallback) están en ETAPA1-03.
