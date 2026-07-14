# Plan de Ejecución — Robustez de la capa TTS (crash y cuelgue de msedge-tts)

## Metadatos

- **Ticket:** FIX-TTS-ROBUSTEZ
- **Versión:** v1.0
- **Fecha:** 2026-07-10
- **Origen:** `ENTREVISTADOR_IA_LEIA_FIX-TTS-ROBUSTEZ_ARQUITECTO_v1.0.md`
- **Destinatario:** Agente Ejecutor (Codificador).
- **Base de código requerida:** branch `feature/arnes-etapa-1-candidato`, commit `5b26319` (verificada como HEAD).
- **Stack y comandos:** monorepo npm workspaces. Backend: `npm run build --workspace=backend`, `cd backend && npx vitest run`. Node ≥18 (AbortSignal.timeout disponible). No requiere Postgres ni claves de API salvo para el smoke opcional de T05.

---

## Misión

Que ninguna falla de la capa TTS (crash por promesa flotante de msedge-tts, cuelgue de síntesis sin respuesta, error de API de Gemini TTS) tire abajo ni congele el backend: timeout duro en cada driver, descarte del cliente zombie de Edge, y red de seguridad de proceso ante unhandled rejections — degradando siempre a MockTTS para que la entrevista continúe.

---

## Guardarraíles (No Negociables)

- **NO parchear nada dentro de `node_modules`** ni agregar dependencias nuevas (nada de patch-package).
- **NO cambiar** la interfaz `TTSService` ni el shape de `TTSResult`.
- **NO tocar** `backend/src/services/interview/engine.ts` (sus llamadores ya degradan bien), ni `mock.ts`, ni `elevenlabs.ts`.
- **NO agregar** handler de `uncaughtException` — solo `unhandledRejection`. El default de Node para excepciones síncronas no capturadas se mantiene.
- La cadena de fallbacks existente se conserva tal cual: GeminiTTS→EdgeTTS→(mock interno de Edge); EdgeTTS→MockTTS.
- La suite existente debe seguir verde sin modificar ningún test existente.

---

## Entorno de Ejecución

- T01-T04 no requieren servicios levantados (build + vitest solamente).
- T05 (smoke de regresión, opcional pero recomendado): `docker compose up -d postgres` (host 5433) + backend `cd backend && npx tsx src/server.ts`. Health: `curl -H "Authorization: Bearer admin-demo-token-cambiar" http://localhost:4000/api/health` → `"status":"ok"`.

---

## Archivos a Crear

1. `backend/src/services/tts/tts.test.ts`
2. `backend/scripts/verify-unhandled-rejection.ts`

## Archivos a Modificar

1. `backend/src/services/tts/index.ts`
2. `backend/src/services/tts/edge.ts`
3. `backend/src/services/tts/gemini.ts`
4. `backend/src/server.ts`

---

## Tareas (Orden Topológico)

### T01 — Helper de timeout + EdgeTTS robusto

**Qué hacer:**

1. **`index.ts`:** agregar y exportar:

```ts
export const TTS_SYNTH_TIMEOUT_MS = 12_000;

/** Rechaza con Error(`${label}: timeout tras ${ms}ms`) si la promesa no resuelve a tiempo. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: timeout tras ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}
```

2. **`edge.ts`:**
   - El constructor acepta un segundo parámetro opcional `timeoutMs = TTS_SYNTH_TIMEOUT_MS` (guardarlo en un campo privado) — necesario para tests.
   - Extraer el cuerpo actual del try de `synthesize` a un método privado `synthesizeOnce(text)` (misma lógica actual, sin cambios), guardando referencia al stream para poder destruirlo.
   - `synthesize` queda:

```ts
async synthesize(text: string): Promise<TTSResult> {
  try {
    return await withTimeout(this.synthesizeOnce(text), this.timeoutMs, 'edge.tts');
  } catch (err) {
    // Cliente potencialmente zombie (WS muerto o colgado): descartarlo para
    // que la próxima síntesis construya uno nuevo.
    this.clientPromise = null;
    logger.warn({ err }, 'edge.tts: fallback a mock');
    return this.fallback.synthesize(text);
  }
}
```

   - En `synthesizeOnce`, tras obtener el stream, registrar los handlers como hoy; si `synthesize` cae por timeout, invocar `audioStream.destroy()` si está disponible (guardar la referencia en una variable capturada y destruirla en el catch de `synthesize`, o vía un callback de cleanup devuelto — implementación libre mientras el stream no quede colgado con listeners vivos).

**Criterio de validación:** `npm run build --workspace=backend` sin errores.

**Depende de:** Ninguna.

---

### T02 — Timeout en GeminiTTS

**Qué hacer:** en `gemini.ts`, al `fetch` de `synthesize` agregarle `signal: AbortSignal.timeout(TTS_SYNTH_TIMEOUT_MS)` (import de la constante desde `./index`). El catch existente ya rutea cualquier error (incluido `TimeoutError`/`AbortError`) al fallback Edge — no cambiar nada más.

**Criterio de validación:** `npm run build --workspace=backend` sin errores.

**Depende de:** T01 (usa la constante).

---

### T03 — Red de seguridad global + script de verificación

**Qué hacer:**

1. **`server.ts`:** cerca del arranque (después de crear el logger, antes de levantar Fastify), agregar:

```ts
let unhandledRejections = 0;
process.on('unhandledRejection', (reason) => {
  unhandledRejections++;
  logger.error(
    { err: reason instanceof Error ? reason : new Error(String(reason)), count: unhandledRejections },
    'unhandledRejection capturada — el proceso sigue vivo (ver FIX-TTS-ROBUSTEZ)'
  );
});
```

2. **`backend/scripts/verify-unhandled-rejection.ts`** (nuevo): script standalone que (a) instala un handler idéntico al de `server.ts`, (b) dispara una promesa flotante que rechaza (mismo patrón que `msedge-tts`: `Promise.reject(new Error('Edge TTS WebSocket error: (code=ETIMEDOUT)')).then(() => {})` o equivalente `somePromise.then()` sin catch), (c) espera 200ms, y (d) hace `process.exit(0)` con un `console.log` de éxito. Si el proceso muere antes por la rejection, el exit code no será 0 — eso es el criterio observable. Incluir header comentado explicando su propósito (no es parte de la suite ni del build).

**Criterio de validación:** `cd backend && npx tsx scripts/verify-unhandled-rejection.ts && echo SOBREVIVIO` imprime `SOBREVIVIO` (exit 0). Como control negativo, documentar en el informe que sin handler el mismo patrón mata el proceso (puede verificarse comentando el handler del script temporalmente durante el desarrollo — no dejar rastro de eso en el archivo final).

**Depende de:** Ninguna (paralelizable con T01-T02).

---

### T04 — Tests unitarios

**Qué hacer:** crear `backend/src/services/tts/tts.test.ts` (vitest, mismas convenciones que `live-session.test.ts`):

1. `withTimeout` resuelve con el valor si la promesa termina antes del límite.
2. `withTimeout` rechaza con mensaje que contiene "timeout" si la promesa nunca resuelve (usar `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync`).
3. `EdgeTTS` con `msedge-tts` mockeado (`vi.mock('msedge-tts', ...)`) devolviendo un stream que **nunca** emite `end`: `new EdgeTTS('es-AR-ElenaNeural', 50).synthesize('hola')` resuelve (no cuelga) con el resultado del mock silente (`mimeType: 'audio/mpeg'`, `audioBase64` no vacío) — es el caso de cuelgue (b) degradando con gracia.
4. Tras esa falla, el campo del cliente cacheado quedó descartado: una segunda llamada vuelve a invocar el factory del mock de `msedge-tts` (assert con contador de invocaciones del mock).

**Criterio de validación:** `cd backend && npx vitest run` → suite completa verde (43 existentes + los nuevos), sin tocar tests existentes.

**Depende de:** T01.

---

### T05 — Verificación final

1. `npm run build --workspace=backend` → sin errores.
2. `cd backend && npx vitest run` → suite completa verde.
3. `cd backend && npx tsx scripts/verify-unhandled-rejection.ts` → exit 0.
4. **Smoke de regresión con Edge real (recomendado si hay red):** levantar backend, crear entrevista `mode=meet` con `ttsDriver: "edge"`, `start`, y verificar en logs que la síntesis real de la apertura sucede sin errores (o, si la red de Edge falla justo, que el log muestre `edge.tts: fallback a mock` y la entrevista siga avanzando — ambos resultados son PASS para este ticket; solo un crash o cuelgue es FAIL).
5. Confirmar `git status`: solo los 6 archivos de las listas.

---

## Tests Obligatorios

| Criterio (del hallazgo) | Cobertura |
|---|---|
| (a) Rejection flotante estilo msedge-tts NO mata el proceso | T03 script (evidencia ejecutable) |
| (b) Síntesis colgada NO congela la entrevista: resuelve con fallback | T04 caso 3 (+ caso 4: cliente zombie descartado) |
| (c) Gemini TTS con error/lentitud degrada sin colgar | T02 (AbortSignal) + catch existente; cubierto por build + revisión (el 400 ya caía al fallback) |
| Regresión: TTS normal sigue funcionando | Suite completa verde + T05 paso 4 |

---

## Qué Hacer al Terminar

1. Informe de Ejecución (`ENTREVISTADOR_IA_LEIA_FIX-TTS-ROBUSTEZ_EJECUCION_v1.0.md` en `docs/specs/`) con la salida real del script de T03 y de la suite.
2. NO hacer commit/push sin confirmación explícita.

---

## CHANGELOG

- v1.0 (2026-07-10): Versión inicial. Timeout+reset en Edge (D1), AbortSignal en Gemini (D2), red de seguridad unhandledRejection (D3), engine intocado (D4), cadena de fallbacks conservada (D5).
