# Informe de Ejecución — Etapa 1: Candidato (4 tickets)

## 0. Metadatos

- **Tickets:** ETAPA1-01, ETAPA1-02, ETAPA1-03, ETAPA1-04
- **Versión del informe:** v1.0
- **Fecha:** 2026-07-07
- **Producido por:** Desarrollador SDD (skill `desarrollador-sdd`)
- **Planes ejecutados:**
  - `ENTREVISTADOR_IA_LEIA_ETAPA1-01_PLAN_EJECUTOR_v1.0.md`
  - `ENTREVISTADOR_IA_LEIA_ETAPA1-02_PLAN_EJECUTOR_v1.0.md`
  - `ENTREVISTADOR_IA_LEIA_ETAPA1-03_PLAN_EJECUTOR_v1.0.md`
  - `ENTREVISTADOR_IA_LEIA_ETAPA1-04_PLAN_EJECUTOR_v1.0.md`
- **Análisis de referencia:** `ENTREVISTADOR_IA_LEIA_ETAPA1_ARQUITECTO_v1.0.md`
- **Branch de trabajo:** `feature/arnes-etapa-1-candidato` (único, per decisión confirmada), desde `main` en commit `68c289e` tras el merge fast-forward de `feature/arnes-etapa-0-saneo` (T00)
- **Estado global:** COMPLETA CON PENDIENTES (ver §8 — un ítem de verificación requiere hardware real que este agente no posee)
- **Commit(s) resultantes:** sin commitear — cambios en working tree, esperando confirmación del desarrollador

---

## 1. Resumen Ejecutivo

- Los 4 tickets de la Etapa 1 se ejecutaron en orden (01→02→03→04, con 04 en paralelo al no tener dependencias), sobre el branch único `feature/arnes-etapa-1-candidato`, tal como se validó con el desarrollador.
- **ETAPA1-01:** consentimiento de grabación (obligatorio) y análisis (opcional) agregado al lobby existente, persistido y auditado; guardarraíl de servidor confirmado (sin consentimiento, el motor no arranca).
- **ETAPA1-02:** `VoiceSession` nueva conecta a Gemini Live (`gemini-2.5-flash-native-audio-latest`, `thinkingBudget:0`) y hace que leIA salude con voz real; probado contra la API real dos veces, con latencia observada de ~1.9s.
- **ETAPA1-03:** conversación completa por Gemini Live (turnos reconstruidos de las transcripciones, evaluados con `leia.evaluate()`), barge-in (`interrupted` → `stop_audio`), y fallback automático y verificado al pipeline TTS existente ante fallo real de Live (probado forzando una API key inválida).
- **ETAPA1-04:** upload de CV en PDF, extracción de texto (`pdf-parse`), inyectado como contexto en los prompts de los 3 drivers de leIA (mock/gemini/claude) y en el system prompt de Gemini Live; falla de extracción no bloquea el inicio de la entrevista (verificado).
- **Verificación final:** `tsc --noEmit` limpio (backend y frontend) y `npx vitest run` en **27/27** tests al cierre (21 heredados de la Etapa 0 + 6 nuevos: 2 en `cv.test.ts`, 4 en `live-session.test.ts`), en todos los checkpoints.
- **Pendiente para el humano:** verificar barge-in con voz real por micrófono (este agente no tiene acceso a un micrófono físico; el mecanismo se probó con el hallazgo confirmado del Spike 2 — audio pausado a tiempo real — pero la interrupción real hablando no pudo ejecutarse en este pase).
- **Hallazgo fuera de alcance (importante):** `POST /api/sala/:id/recording` devuelve 415 (Unsupported Media Type) ante cualquier upload real, porque Fastify no tiene un content-type parser para `video/webm`/`video/mp4`. La grabación de las entrevistas nunca llegó a persistirse en ningún ambiente donde se haya probado. No se corrigió (fuera de alcance de los 4 planes) — ver §7.

---

## 2. Estado por Tarea

### ETAPA1-01 — Lobby con Consentimiento

| Tarea | Estado | Validación ejecutada | Resultado |
|---|---|---|---|
| T00 — Merge etapa0→main + branch etapa1 | COMPLETADA-VALIDADA | `git merge-base --is-ancestor` (confirmó NO mergeado antes de empezar) + `git checkout main && git merge --ff-only` + `git checkout -b` | Fast-forward exitoso; `git log -1 main` muestra `68c289e`; branch activo confirmado |
| T01 — Columnas `consent_recording`/`consent_analysis` | COMPLETADA-VALIDADA | Backend reiniciado contra Postgres + `\d interviews` | Ambas columnas boolean, default `false`, presentes |
| T02 — Tipos y mapping | COMPLETADA-VALIDADA | `tsc --noEmit` backend y frontend | Ambos limpios |
| T03 — Persistir consentimiento en `ready` | COMPLETADA-VALIDADA | Script WS real: `ready` sin consentimiento → entrevista sigue `agendada`; `ready` con consentimiento → `en_curso`, valores persistidos | Confirmado con evidencia real (no simulada) |
| T04 — Checkboxes y gating en el lobby | COMPLETADA-VALIDADA | Preview real: botón `disabled` + opacidad reducida sin tildar; se habilita al tildar; `consentRecording`/`consentAnalysis` llegan correctos al backend | Screenshot y `preview_eval` confirmaron el comportamiento exacto del AC |
| Verificación Final | COMPLETADA-VALIDADA | `tsc --noEmit` x2, `npx vitest run` (21/21), smoke manual completo | Sin regresiones |

### ETAPA1-02 — Conexión Básica a Gemini Live

| Tarea | Estado | Validación ejecutada | Resultado |
|---|---|---|---|
| T01 — `@google/genai` a dependencies + export `pcmToWav` | COMPLETADA-VALIDADA | `node -e` verificando `package.json` + `tsc --noEmit` | Versión exacta `2.10.0` en `dependencies` |
| T02 — Columna `voice_mode` + tipos | COMPLETADA-VALIDADA | `\d interviews` tras reinicio | Columna + constraint `CHECK (voice_mode IN ('live','pipeline'))` presentes |
| T03 — `VoiceSession` (conexión + saludo + latencia) | COMPLETADA-VALIDADA | `tsc --noEmit` | Sin errores |
| T04 — Tests de funciones puras | COMPLETADA-VALIDADA | `npx vitest run live-session.test.ts` | 2/2 (luego ampliados a 4/4 en ETAPA1-04) |
| T05 — Integración en `InterviewEngine.start()` | COMPLETADA-VALIDADA | `tsc --noEmit` + `npx vitest run` (23/23) | Sin regresiones |
| Verificación Final | COMPLETADA-VALIDADA | Smoke real contra Gemini Live (API real, key válida): conexión, saludo audible, latencia **1920ms** logueada, avatar reactivo (barras de sonido + borde azul confirmados por screenshot), regresión en modo `pipeline` confirmada sin cambios | Ver §4 y evidencia en el log del backend |

### ETAPA1-03 — Barge-in Real y Cadena de Fallback

| Tarea | Estado | Validación ejecutada | Resultado |
|---|---|---|---|
| T01 — Caracterización del guard de half-duplex | **OMITIDA-YA-CUMPLIDA** | Lectura de `engine.test.ts` | Los tests "modo meet: ignora... (eco)" y "modo browser: el caption... SÍ alimenta" (heredados de la Etapa 0) ya caracterizan `isBotSpeaking()` exactamente como pedía esta tarea; siguen pasando en la suite final |
| T02 — Captura de audio del candidato (frontend+backend) | COMPLETADA-VALIDADA | `tsc --noEmit` x2; inspección de código (`ScriptProcessorNode` a 16kHz, `candidate_audio` por WS) | Sin errores; no se pudo probar con micrófono real (ver §8) |
| T03 — `sendCandidateAudio` + `interrupted`/`turnComplete` | COMPLETADA-VALIDADA | `tsc --noEmit` | Sin errores |
| T04 — Ciclo de turnos completo + fallback | COMPLETADA-VALIDADA | Smoke real (ver §4): conexión estable 90s sin caída espuria; **fallback forzado con API key inválida real** → entrevista continuó por pipeline TTS (con su propio fallback interno a Edge TTS) sin romperse; cierre e informes generados normalmente | Ver evidencia en §4 |
| Verificación Final | COMPLETADA-VALIDADA (con 1 pendiente) | `tsc --noEmit` x2, `npx vitest run` (23/23) | Build y suite verdes; **barge-in con voz real queda pendiente del humano** (§8) |

### ETAPA1-04 — CV del Candidato en el Contexto de leIA

| Tarea | Estado | Validación ejecutada | Resultado |
|---|---|---|---|
| T01 — `pdf-parse` + `extractCvText` | COMPLETADA-VALIDADA | `tsc --noEmit` | Sin errores. Ver Desviación D9 (versión pineada) |
| T02 — Tests de extracción | COMPLETADA-VALIDADA | `npx vitest run cv.test.ts` | 2/2 (PDF real vía fixture + buffer inválido → `null`) |
| T03 — Columna `cv_text` + endpoint de upload | COMPLETADA-VALIDADA | `\d interviews`, `curl` real con PDF de fixture (200, `extracted:true`, texto persistido) y con contenido inválido (200, `extracted:false`) | Ver Desviación D10 (ruta y parser) |
| T04 — Inyección del CV en prompts | COMPLETADA-VALIDADA | `tsc --noEmit`, `npx vitest run` (27/27, incluye 2 tests nuevos de `buildLiveSystemPrompt` con/sin CV) | Sin errores; sección de CV se agrega en los 3 drivers + Live, condicional (no aparece "undefined" cuando no hay CV) |
| T05 — Upload desde el frontend | COMPLETADA-VALIDADA | Preview real: input de archivo visible, `apiUploadCv` invocado con un PDF simulado (`DataTransfer`), estado de UI actualizado correctamente (`"No pudimos leer..."` para contenido inválido) | Sin errores de consola |
| Verificación Final | COMPLETADA-VALIDADA | `tsc --noEmit` x2, `npx vitest run` (27/27) | Sin regresiones |

---

## 3. Log de Desviaciones

| # | Ticket/Tarea | Tipo | Qué decía el plan | Qué se encontró | Qué se hizo / Disposición |
|---|---|---|---|---|---|
| D1 | ETAPA1-02 T01 | Menor | — | — | Ninguna, ejecutado tal cual |
| D2 | ETAPA1-02 Verificación Final | Menor | "si no existe forma de setear `voiceMode` desde la API, agregarla... decisión menor del Ejecutor" | No existía ningún endpoint que aceptara `voiceMode` al crear la entrevista | Se agregó `voiceMode` opcional a `CreateInterviewSchema` en `backend/src/routes/interviews.ts` (archivo fuera de la lista original del plan, pero explícitamente pre-autorizado por el propio texto del plan) |
| D3 | ETAPA1-03 T04 | Mayor (resuelta sin bloqueo) | El plan asumía que el ciclo de turnos live podía reutilizar directamente `askQuestion`/`commitAnswer` | Gemini Live conduce su propia conversación (genera preguntas autónomamente vía su system prompt); no hay un punto natural para invocar `askQuestion` en medio del flujo Live | Se implementó un mecanismo paralelo (`handleLiveTurnComplete`) que reconstruye turnos desde los límites de `turnComplete`, llama `leia.evaluate()` solo para puntuar/decidir cierre (descartando su `nextQuestion`), y usa `askQuestion` únicamente al hacer fallback a pipeline. Documentado en el propio código con comentarios explicando el porqué |
| D4 | ETAPA1-03 T02 | Menor | "usar `AudioContext` + `ScriptProcessorNode`/`AudioWorklet`... o `MediaRecorder`... documentar cuál se eligió" | — | Se eligió `ScriptProcessorNode` (deprecado pero universalmente soportado en Chrome, sin necesidad de cargar un módulo de worklet separado) sobre un `AudioContext` dedicado a 16kHz, para evitar la complejidad de resampleo manual |
| D5 | ETAPA1-04 T01 | Menor (decisión técnica) | El plan asumía la API clásica de `pdf-parse` (`pdfParse(buffer).then(d => d.text)`) | El paquete `pdf-parse` en su versión `latest` (2.x) es una reescritura completa con API distinta y una dependencia nativa pesada (`@napi-rs/canvas`, ~21MB) | Se pineó `pdf-parse` a la línea `^1.1.1` (MIT, sin dependencias nativas), que sí expone la API que el plan asumía y que ya se usa en el código |
| D6 | ETAPA1-04 T02 | Menor | "generar uno [PDF] de fixture" — sin especificar cómo | Un PDF hand-rolled con tabla xref simplificada fallaba en pdf.js (`bad XRef entry`) incluso con offsets correctos | Se generó un PDF real con la herramienta `cupsfilter` del sistema (macOS) y se lo commiteó como fixture binario (`backend/src/services/interview/cv-sample.pdf`, no listado explícitamente en el plan pero es un artefacto de test necesario para T02) |
| D7 | ETAPA1-04 T03 | **Mayor** | Endpoint sugerido: `POST /api/interviews/:id/cv` | Ese path no está exento del middleware de auth (`Authorization: Bearer <ADMIN_TOKEN>`) en `server.ts`, pero el candidato (sin token) es quien debe llamarlo desde el lobby | Se implementó como `POST /api/sala/:id/cv` en `browser-sala.ts` (ya exento de auth por el prefijo `/api/sala/`), replicando el patrón exacto de `/api/sala/:id/recording`. `frontend/lib/api.ts`'s `apiUploadCv` apunta a esa ruta. Disposición: decisión propia del Ejecutor, sin consultar al desarrollador por ser de bajo riesgo y claramente dentro del espíritu del plan (que ya anticipaba esta situación); documentada aquí para trazabilidad |
| D8 | ETAPA1-04 T03 | Menor (mecanismo) | — | Fastify no tiene parser por defecto para `application/pdf` | Se registró `app.addContentTypeParser('application/pdf', ...)` **dentro de `browserSalaRoute()`**, aprovechando la encapsulación de plugins de Fastify para que el parser no afecte otras rutas del sistema |
| D9 | ETAPA1-04 T04 | Menor | "evaluar si conviene agregarlo al objeto `Interview`/`Candidate` que ya reciben esos métodos en vez de agregar un parámetro nuevo" | `FirstQuestionInput`/`EvaluateInput` no reciben el objeto `Interview`/`Candidate` completo, solo campos sueltos (`job`, `candidateName`, etc.) | No había objeto existente al que "adjuntar" el CV sin cambiar la firma; se agregó `cvText?: string | null` a ambas interfaces, consistente con el estilo ya usado en el resto del archivo (un único objeto de input por método) |

---

## 4. Evidencia de Verificación Real (no simulada)

Los siguientes puntos requieren mención aparte porque involucraron la API real de Gemini Live y no solo mocks:

- **Saludo real (ETAPA1-02):** dos corridas distintas contra la API real con key válida. Latencias observadas: 1920ms y 1013ms (según corrida). Avatar confirmado reaccionando (sound bars + borde azul) mediante screenshot durante la reproducción.
- **Fallback real (ETAPA1-03):** se invalidó temporalmente `GEMINI_API_KEY` en `backend/.env` (con backup y restauración inmediata vía `sed`/`cp`, sin exponer la clave real en ningún momento de la transcripción de esta sesión), se forzó una conexión real fallida a Gemini Live, y se confirmó en el log del backend la secuencia completa: `voice-session: conectado` → `sesión Live cerrada` → `voice-session: fallback a pipeline TTS` → entrevista continuada con Edge TTS (el propio fallback interno de `GeminiTTS` también se activó, en cascada) → subtítulo visible en el frontend → entrevista funcionando con normalidad.
- **Estabilidad del camino feliz (ETAPA1-03):** con key real restaurada, una entrevista live se mantuvo `en_curso` sin caerse durante 90+ segundos (greeting + espera de respuesta del candidato vía VAD), confirmando que el ciclo no cae a fallback espuriamente cuando todo funciona bien.
- Un cierre prematuro observado en un intento anterior (~16s, sin actividad del candidato) se investigó y se atribuyó de forma concluyente a una caída del propio servidor de desarrollo de Next.js (no al código de este ticket) — confirmado porque el servidor de preview efectivamente había dejado de responder (`preview_list` devolvió vacío) exactamente en ese momento.

---

## 5. Tests Obligatorios

| Test (BDD del contrato) | Archivo | Resultado |
|---|---|---|
| AC-NEW-01 — Sin consentimiento no arranca | WS real + smoke UI | PASA |
| AC-NEW-02 — Consentimiento parcial (sin análisis) corre igual | WS real + `GET /api/interviews/:id` | PASA |
| AC-NEW-04 (parcial, latencia) — VoiceSession | Log real del backend | PASA (~1-2s, en línea con el spike) |
| AC-NEW-03 — Barge-in real | — | **NO EJECUTABLE por este agente** (requiere micrófono físico); mecanismo implementado y con la guía de smoke lista para el humano en §8 |
| AC-NEW-05 — Fallback ante fallo de Live | Log real del backend + smoke UI | PASA (ver §4) |
| AC-NEW-06 — CV disponible como contexto | `live-session.test.ts` (2 tests nuevos) + inspección de `prompts.ts`/drivers | PASA |
| Test — CV inválido no bloquea | `cv.test.ts` + `curl` real + smoke UI | PASA |

---

## 6. Archivos Tocados

Coincide con `git status --short` al cierre.

**Creados:**
- `backend/src/services/voice/live-session.ts` — `VoiceSession`, registro global, `buildLiveSystemPrompt`.
- `backend/src/services/voice/live-session.test.ts`
- `backend/src/services/interview/cv.ts` — `extractCvText`.
- `backend/src/services/interview/cv.test.ts`
- `backend/src/services/interview/cv-sample.pdf` — fixture binario real (Desviación D6).

**Modificados:**
- `backend/package.json` — `@google/genai` a dependencies (versión exacta); `pdf-parse` + `@types/pdf-parse`.
- `backend/src/db/schema.sql` — columnas `consent_recording`, `consent_analysis`, `voice_mode`, `cv_text` + constraint de `voice_mode`.
- `backend/src/db/postgres.ts` — mapping de las 4 columnas nuevas.
- `backend/src/types.ts` / `frontend/lib/types.ts` — campos nuevos de `Interview`.
- `backend/src/realtime/browser-sala.ts` — consentimiento en `ready`, `voiceMode` en `/info`, ruteo de `candidate_audio`, endpoint `POST /api/sala/:id/cv` (Desviación D7/D8).
- `backend/src/services/recall/browser.ts` — tipo `stop_audio` agregado a `SalaMsg`.
- `backend/src/routes/interviews.ts` — `voiceMode` opcional en la creación (Desviación D2).
- `backend/src/services/interview/engine.ts` — rama `voiceMode==='live'` completa: conexión, ciclo de turnos, fallback.
- `backend/src/services/leia/index.ts`, `mock.ts`, `gemini.ts`, `claude.ts`, `prompts.ts` — `cvText` en inputs y prompts.
- `backend/src/services/tts/gemini.ts` — export de `pcmToWav`.
- `frontend/app/sala/[id]/page.tsx` — checkboxes de consentimiento, captura de audio del candidato, manejo de `stop_audio`, input de CV.
- `frontend/lib/api.ts` — `apiUploadCv`.
- `package-lock.json` — reflejando las nuevas dependencias.

**Fuera de las listas originales de los planes (documentado arriba en el Log de Desviaciones):** `backend/src/routes/interviews.ts` (D2), `backend/src/services/interview/cv-sample.pdf` (D6). Ambos pre-autorizados o de bajo riesgo; ninguno requiere disposición adicional.

---

## 7. Hallazgos Fuera de Alcance

- **`POST /api/sala/:id/recording` devuelve 415 ante cualquier upload real.** Fastify solo tiene parsers por defecto para `application/json` y `text/plain`; el `Content-Type` real que manda el frontend (`video/webm` o similar, según `blob.type`) no tiene parser registrado, y Fastify rechaza la request antes de que el handler la vea. Confirmado con `curl` real contra el endpoint (`{"statusCode":415,...}`). El frontend nunca se entera porque el `fetch` de la grabación tiene un `.catch(() => {})` silencioso. **Esto significa que ninguna grabación de entrevista se persiste hoy, en ningún modo (pipeline o live).** No se corrigió: no está en el alcance de ningún archivo de los 4 planes de esta etapa, y una corrección apropiada (registrar un content-type parser adecuado, decidir si además hay que persistir a disco/S3 en vez de solo loguear) es una decisión de diseño que le corresponde al Arquitecto, no a este pase. Sugerido como ticket aparte.
- **`tsx watch` con `DATABASE_DRIVER=memory` sigue roto en Node ≥20** (heredado de la Etapa 0, documentado ahí, reconfirmado incidentalmente al no verse afectado por ningún cambio de esta etapa — se sigue usando `DATABASE_DRIVER=postgres` para todo el desarrollo).

---

## 8. Pendientes y Próximos Pasos

- [ ] **Verificar barge-in con voz real** (AC-NEW-03): abrir una entrevista en modo `live`, y mientras leIA está hablando, interrumpirla hablando por el micrófono real. Se espera que el audio se corte en menos de ~1 segundo (evento `stop_audio`) y que el sistema pase a escuchar. El mecanismo está implementado (`sendCandidateAudio` pausado a tiempo real, `interrupted` → `stop_audio`) pero este agente no tiene acceso a un micrófono físico para generar el audio de interrupción.
- [ ] **Gestionar el hallazgo fuera de alcance de `/recording`** (§7) — decidir si se abre un ticket nuevo o se atiende en la próxima etapa.
- [ ] **Commit/push** — sin hacer, esperando confirmación explícita del desarrollador.
- [ ] Considerar, en una futura iteración, probar una entrevista `live` completa de punta a punta (varios turnos reales con respuestas por voz) — lo probado en este pase cubre conexión, saludo, estabilidad y fallback, pero no un ciclo largo de múltiples turnos con respuestas reales del candidato (requiere igualmente un micrófono real).

---

## CHANGELOG

- v1.0 (2026-07-07): Ejecución inicial de los 4 Planes Ejecutores de la Etapa 1 (ETAPA1-01 a ETAPA1-04), sobre `feature/arnes-etapa-1-candidato`. Estado global: COMPLETA CON PENDIENTES. Tareas: 19 completadas-validadas, 1 omitida-ya-cumplida, 0 bloqueadas. Desviaciones: 7 menores, 2 mayores (ambas resueltas sin bloqueo, documentadas en §3).
