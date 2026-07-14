# Plan de Ejecución — Cierre de la Etapa 1: sesiones Live largas + CV verificable

## Metadatos

- **Ticket:** ETAPA1-CIERRE
- **Versión:** v1.0
- **Fecha:** 2026-07-07
- **Origen:** `ENTREVISTADOR_IA_LEIA_ETAPA1-CIERRE_ARQUITECTO_v1.0.md` (brechas AC-NEW-04 y AC-NEW-06 del contrato `ENTREVISTADOR_IA_LEIA_CAMBIOS_PROPUESTOS_v1.0.md` §8.1).
- **Destinatario:** Agente Ejecutor (Codificador).
- **Base de código requerida:** branch `feature/arnes-etapa-1-candidato`, commit `e351530` (verificada como HEAD, working tree limpio salvo stubs de backup vacíos).
- **Stack y comandos:** monorepo npm workspaces. Backend: `npm run build --workspace=backend`, `cd backend && npx vitest run`. Frontend: `npm run build --workspace=frontend` (no debería tocarse). Postgres local: `docker compose up -d postgres` (host **5433**). Auth API admin: `Authorization: Bearer admin-demo-token-cambiar`. `GEMINI_API_KEY` de tier pago válida en `backend/.env` (obligatoria para T03 y T05).
- **Estructura:** dos grupos independientes — Grupo A (T01-T03, AC-NEW-04) y Grupo B (T04-T05, AC-NEW-06). Pueden ejecutarse en cualquier orden entre grupos; dentro de cada grupo, en orden.

---

## Misión

Cerrar los dos AC pendientes de la Etapa 1: que la sesión de Gemini Live sobreviva sus límites de duración (~10 min de conexión, ~15 min de audio) vía session resumption + context window compression con reconexión automática encapsulada en `VoiceSession`, y que la referencia de leIA al CV del candidato sea concreta y verificable en los tres drivers (mock incluido) y en modo live.

---

## Guardarraíles (No Negociables)

- **NO tocar** `backend/src/services/interview/engine.ts`: la semántica de su callback `onClose` ("cierre no intencional → fallback a pipeline") sigue siendo correcta y es la red de seguridad final. Toda la lógica de reconexión vive en `VoiceSession`.
- **NO re-enviar el saludo** tras una reconexión con handle — el estado conversacional se restaura del lado del servidor.
- **NO tocar** los drivers `gemini.ts`/`claude.ts` de leIA (la inyección del CV ya está; T05 es verificación, no código).
- **NO tocar** el frontend.
- El script de soak es de `backend/scripts/` (mismo patrón que `spike-live-api.ts`): NO forma parte del build de producción ni de la suite vitest.
- Sin dependencias nuevas.
- La interfaz pública de `VoiceSession` usada por el engine (`connectAndGreet`, `sendCandidateAudio`, `sendTextInstruction`, `close`, y el shape de `VoiceSessionEvents`) no cambia.

---

## Entorno de Ejecución

- `docker compose up -d postgres` (host 5433) + backend (`npx tsx src/server.ts` desde `backend/`) + frontend solo para el smoke de T05-live.
- Health check: `curl -H "Authorization: Bearer admin-demo-token-cambiar" http://localhost:4000/api/health` → `"status":"ok"`.
- T03 corre contra la API real ≥12 minutos — lanzarlo en background y monitorear; no es interactivo.

---

## Archivos a Crear

1. `backend/scripts/soak-live-session.ts`

## Archivos a Modificar

1. `backend/src/services/voice/live-session.ts`
2. `backend/src/services/leia/mock.ts`
3. `backend/src/services/voice/live-session.test.ts` y/o test del mock (según dónde caigan las funciones puras nuevas)

---

## Tareas

### Grupo A — AC-NEW-04

### T01 — Resumption, compresión y goAway en la config y el onmessage

**Qué hacer:** en `backend/src/services/voice/live-session.ts`:
1. Agregar a la config de conexión: `sessionResumption: {}` y `contextWindowCompression: { slidingWindow: {} }`.
2. En `onmessage`, ANTES del bloque de `serverContent`, manejar dos mensajes de nivel superior:
   - `msg.sessionResumptionUpdate`: si `resumable && newHandle`, guardar `this.resumptionHandle = newHandle` (log nivel debug con los primeros ~12 chars del handle, no entero).
   - `msg.goAway`: `logger.info({ timeLeft: msg.goAway.timeLeft }, 'voice-session: goAway recibido, reconectando proactivamente')` y disparar la reconexión de T02.

**Criterio de validación:** `npm run build --workspace=backend` sin errores.

**Depende de:** Ninguna.

---

### T02 — openSession/reconnect y política de reintentos

**Qué hacer:** en el mismo archivo:
1. Extraer la conexión a `private async openSession(handle?: string)`: construye la config (con `sessionResumption: handle ? { handle } : {}`) y los callbacks compartidos, asigna `this.session`. `connectAndGreet` pasa a: `await this.openSession(); this.session.sendClientContent({...saludo})`.
2. `private intentionalClose = false;` — `close()` lo setea en true antes de cerrar.
3. `private reconnectAttempts = 0;` con máximo 2.
4. `private async reconnect()`: si no hay `resumptionHandle` → no hace nada y devuelve false. Si hay: incrementa intentos, cierra la sesión vieja sin marcar intencional (cuidado con no re-disparar el propio onclose — usar un flag `reconnecting` que el onclose consulte), espera ~500ms, `openSession(this.resumptionHandle)`, resetea `reconnectAttempts` en éxito, log info. Devuelve true/false.
5. En el callback `onclose` del SDK: si `intentionalClose` o `reconnecting` → no emitir nada (o solo log debug). Si no: si hay handle y `reconnectAttempts < 2` → `reconnect()`; si reconecta OK, NO emitir `events.onClose`. Si no hay handle o la reconexión falla → `events.onClose(code, reason)` (el engine hace el fallback como hasta ahora).
6. El manejo de `goAway` (T01) llama a `reconnect()` proactivamente.

**Criterio de validación:** `npm run build --workspace=backend` sin errores; `cd backend && npx vitest run` → suite completa verde (si se extraen funciones puras testeables — ej. la decisión "¿debo reconectar?" como función pura de (intentional, reconnecting, handle, attempts) — agregar 2-3 casos a `live-session.test.ts`).

**Depende de:** T01.

---

### T03 — Script de soak y corrida real

**Qué hacer:** crear `backend/scripts/soak-live-session.ts` (patrón de `spike-live-api.ts`: standalone, `npx tsx`, lee `GEMINI_API_KEY` del env):
1. Abre una sesión Live con exactamente la misma config que `VoiceSession` (importar/duplicar la config; si `VoiceSession` es directamente instanciable fuera del engine, usarla — preferible, prueba el código real).
2. Cada ~20s envía un fragmento corto de audio PCM 16kHz paced (reutilizar el helper de síntesis del spike, o alternar tono/silencio) para mantener actividad realista.
3. Registra con timestamp: cada `sessionResumptionUpdate` (¿llegan handles? ¿cuándo?), cada `goAway`, cada reconexión (inicio/resultado), cada cierre, y cada respuesta de audio del modelo.
4. Corre **≥12 minutos** (configurable por env `SOAK_MINUTES`, default 13) para cruzar el límite de ~10 min de conexión.
5. Al final imprime un resumen JSON y termina con exit 0 si la sesión (original o reconectada) seguía viva y respondiendo al final, exit 1 si murió sin recuperarse.

**Corrida obligatoria:** ejecutarlo de verdad una vez (`cd backend && npx tsx scripts/soak-live-session.ts`, en background, ~13 min) y capturar el resumen final. Si el resultado es exit 1 o nunca llegan handles (riesgo R1 del análisis), NO improvisar arreglos: documentar el resultado crudo y reportarlo — es una decisión de aceptación para el humano/Arquitecto.

**Criterio de validación:** el resumen JSON real de la corrida, pegado en el Informe de Ejecución.

**Depende de:** T02.

---

### Grupo B — AC-NEW-06

### T04 — Mock con referencia concreta al CV

**Qué hacer:** en `backend/src/services/leia/mock.ts`:
1. Agregar una función auxiliar determinista `extractCvHighlight(cvText: string, candidateName: string): string | null` — devuelve un fragmento notable del CV: la secuencia de palabras capitalizadas más larga que no esté contenida en el nombre del candidato (ej. "MercadoLibre", "Universidad Nacional de Cuyo"); si no hay ninguna, la primera línea no vacía truncada a 60 chars; si el texto está vacío → null. Exportarla para test.
2. En `firstQuestion`: si `input.cvText` presente y `extractCvHighlight` devuelve algo, el saludo incluye la cita concreta, p. ej.: `Vi en tu CV que mencionás «${highlight}» — más adelante quiero que me cuentes de eso.` (reemplaza el genérico "Ya vi tu CV, así que voy a hacerte alguna pregunta más puntual." actual). Sin CV o sin highlight → comportamiento actual sin CV.
3. Test unitario (en el archivo de tests que corresponda por convención): (a) con un cvText que contiene "Trabajé 3 años en MercadoLibre como frontend", el saludo del mock contiene "MercadoLibre"; (b) sin cvText, el saludo no menciona CV; (c) `extractCvHighlight` no devuelve el nombre del candidato.

**Criterio de validación:** `cd backend && npx vitest run` → suite completa verde con los casos nuevos.

**Depende de:** Ninguna (paralelizable con Grupo A).

---

### T05 — Verificación de AC-NEW-06 contra drivers reales

**Qué hacer (ejecución, no código):**
1. **Pipeline + Gemini real:** crear candidato+entrevista `mode=meet` (con `meetUrl` `https://meet.google.com/xxx-xxxx-xxx` de fantasía — el recall mock no valida), setear `cvText` distintivo (vía `POST /api/sala/:id/cv` con un PDF cuyo texto incluya "Trabajé 3 años en MercadoLibre como frontend", o update directo en BD), reiniciar backend con `LEIA_DRIVER=gemini`, iniciar con `POST /api/interviews/:id/start`, responder 3 turnos vía `POST /api/interviews/:id/simulate-answer`, y verificar en `GET /api/interviews/:id` que al menos una pregunta de los primeros 3 turnos referencia contenido concreto del CV (ej. contiene "MercadoLibre" o "3 años"). Hasta 2 corridas si la primera no lo menciona (no determinismo, riesgo R3).
2. **Live:** crear entrevista `browser`+`voiceMode='live'` con el mismo CV, abrirla vía navegador (preview alcanza — la verificación es textual, no auditiva), y verificar en el turno T0 persistido o en los logs de transcripción de salida que el saludo/primera pregunta referencia el CV concreto.
3. Restaurar `LEIA_DRIVER` al valor original al terminar.

**Criterio de validación:** las citas textuales reales de las preguntas que referencian el CV, pegadas en el Informe de Ejecución (una por cada modo). Si tras 2 corridas el driver real no lo menciona: reportar como hallazgo (ajuste de prompt = nueva iteración con el Arquitecto), no parchear prompts en este pase.

**Depende de:** T04 (para que la suite ya esté verde), Grupo A no es prerrequisito.

---

## Tests Obligatorios

| AC del contrato | Cobertura en este plan |
|---|---|
| AC-NEW-04 — Sesión Live de 20+ min | T03 (soak real ≥12 min cruzando el límite de conexión, con resumen crudo como evidencia). La entrevista humana completa de 20 min queda como validación opcional post-cierre. |
| AC-NEW-06 — leIA usa el CV real | T04 (mock, unit test determinista) + T05 (Gemini real en pipeline y modo live, citas textuales como evidencia). |

---

## Verificación Final

**Automáticas:**
1. `npm run build --workspace=backend` → sin errores.
2. `npm run build --workspace=frontend` → sin errores (no debería haber cambios).
3. `cd backend && npx vitest run` → suite completa verde (27 + los casos nuevos de T02/T04).

**Semi-automáticas (una sola vez, con API real):**
4. Corrida del soak (T03) con su resumen JSON.
5. Verificación de CV contra Gemini real y live (T05) con citas textuales.

**Regresión:**
6. Smoke corto de una entrevista live normal (~2 min, vía preview): la sesión conecta, saluda y cierra limpio — confirma que resumption+compression en la config no rompieron el flujo corto ya verificado.

---

## Qué Hacer al Terminar

1. Informe de Ejecución con: resumen del soak (crudo), citas textuales del CV por driver, y estado final de AC-NEW-04 y AC-NEW-06 (COMPLETO / PARCIAL con causa).
2. Si el soak revela que el proveedor no emite handles (R1): reportarlo como limitación externa con la evidencia — la disposición (aceptar como limitación de la demo o escalar) es del humano.
3. NO hacer commit/push sin confirmación explícita.

---

## CHANGELOG

- v1.0 (2026-07-07): Versión inicial. Cierra AC-NEW-04 (resumption+compression+reconexión+soak) y AC-NEW-06 (mock concreto + verificación contra drivers reales).
