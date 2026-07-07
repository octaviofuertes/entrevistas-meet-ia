# Entrevistador IA leIA — Arnés del Agente (Etapas 0-3) — Cambios Propuestos

> Este MD describe modificaciones a aplicar sobre la funcionalidad existente cuyo snapshot está en el archivo de referencia. **Debe leerse junto con el snapshot, no en lugar de él.** El Arquitecto SDD debe consumir ambos documentos como un par.

---

## 0. Metadatos

- **ID Ticket:** N/A (iniciativa interna "producto wow"; los artefactos fuente son la propuesta y la investigación citadas abajo)
- **Versión:** v1.0
- **Fecha:** 2026-07-06
- **Producido por:** Ingeniero de Requisitos SDD con acceso a código (skill ing-requisitos-sdd) — modo (b+c) HÍBRIDO
- **Snapshot de referencia:** `ENTREVISTADOR_IA_LEIA_ELICITADOR_MODO-D_v1.0.md` (base: `origin/feature/sala-nativa @ fa9a386`)
- **Documentos fuente del cambio:** `docs/PROPUESTA_ARNES_AGENTE_ENTREVISTADOR_v1.0.md` (aprobada, con decisiones §7-bis) y `docs/INVESTIGACION_ECOSISTEMA_GOOGLE_2026-07.md` (proveedores validados a julio 2026)
- **Tipo de cambio:** Híbrido extensión + capacidad nueva
- **Dependencias previas:** **`origin/develop` (`eb6e489`) y `origin/feature/sala-nativa` (`fa9a386`) están SIN MERGEAR a `main`** — su integración es T01, prerrequisito de todo lo demás. Además `develop` contiene `fromForm.ts` que rompe `tsc` (snapshot §8.3.2); su resolución es T02.
- **Decisiones del product owner cerradas en sesión (2026-07-06):** (1) análisis facial **ON por defecto**, desactivable por puesto `[USR]`; (2) `fromForm.ts` se **completa** como feature, no se elimina `[USR]`; (3) la demo corre con **Postgres real** `[USR]`; (4) CV con **upload PDF + extracción simple de texto** `[USR]`; (5) tiers default/premium y matriz por canal según §7-bis de la propuesta `[USR]`.
- **Próximo destinatario:** Agente Arquitecto (skill arquitecto-sdd)

---

## 1. Resumen del Cambio

Se transforma la PoC en el **arnés de un agente entrevistador** vendible como demo en 2-3 semanas: el diferencial no es el LLM (ya intercambiable vía `LeiaService`) sino el cuerpo — voz de baja latencia con interrupciones, presencia (avatar con estados), sentidos (señales de cámara conectadas al informe), sala de observación en vivo para el reclutador y susurro humano-en-el-loop. La motivación de negocio y el guion de demo objetivo están en la propuesta §1-2 `[DOC: PROPUESTA §1-2]`.

El cambio se organiza en 4 etapas: **Etapa 0** (saneo: merge de branches, completar la feature rota de puesto-desde-formulario, persistir `mode` en Postgres, README); **Etapa 1** (wow candidato en sala nativa: lobby con consentimiento, **Gemini Live API como driver primario de voz con barge-in nativo**, fallback a pipeline GA, avatar audio-reactivo, CV en el contexto de leIA); **Etapa 2** (wow reclutador: sala de observación sobre el WS existente, susurro, señales de comportamiento conectadas, informe compartible); **Etapa 3** (pulido del canal Meet, puntos de integración del producto real comentados, seed y guion de demo).

Impacto de alto nivel: frontend (lobby, sala de observación nueva, formulario de puesto, avatar), backend (driver Live API, cola de susurro, ruta from-form, `structureJob` en los 3 drivers de leIA, extracción de CV, links firmados de informe), persistencia (columna `mode`, campos nuevos de `Job`, flag de análisis en `JobPreferences`), integraciones nuevas (Gemini Live API; HeyGen/Simli solo como punto de integración con feature-flag, sin contratar).

---

## 2. Nuevos Outcomes

- **Nuevo Outcome A — Lobby con consentimiento:** antes de entrar a la sala nativa, el candidato pasa por un lobby que verifica cámara/micrófono, presenta el contexto (puesto, empresa, duración) y captura consentimiento explícito de grabación y análisis; sin consentimiento de análisis, las señales de cámara no se capturan aunque el puesto las tenga activadas. `[CHG]` `[USR]`
- **Nuevo Outcome B — Conversación con interrupciones (sala nativa):** el candidato puede interrumpir a leIA a mitad de frase; leIA corta su audio, escucha y responde a lo nuevo. Con el driver primario (Gemini Live API) el barge-in es nativo del canal `[DOC: INVESTIGACION §1]`; con el pipeline de fallback, la sala pausa el audio y descarta la cola TTS pendiente. `[CHG]`
- **Nuevo Outcome C — Latencia conversacional objetivo:** en sala nativa con Live API, la primera sílaba de leIA suena en menos de ~1.5 s desde que el candidato termina de hablar (objetivo de demo, a medir). `[CHG]` `[DOC: PROPUESTA §3.1-A]`
- **Nuevo Outcome D — Sala de observación en vivo:** el reclutador ve en `/entrevistas/:id/live` la transcripción en tiempo real, la pregunta actual, el estado de leIA (escuchando/pensando/hablando), el radar de dimensiones llenándose turno a turno y los flags al instante — consumiendo el WS `/ws/interview/:id` que ya emite todos los eventos `[CODE: backend/src/realtime/interview-ws.ts]`. `[CHG]`
- **Nuevo Outcome E — Susurro del reclutador:** desde la sala de observación, el reclutador sugiere una pregunta; leIA la incorpora con su estilo en el siguiente turno, pasando por el guard anti-repetición existente `[CODE: engine.ts findSimilarQuestion]`. `[CHG]`
- **Nuevo Outcome F — Señales de comportamiento en el informe:** en sala nativa con análisis activado y consentido, las métricas de atención/lectura/presencia (`useFaceAnalysis` existente `[CODE: frontend/lib/useFaceAnalysis.ts]`) más pérdida de foco de pestaña se acumulan como `BehavioralAnalysis` y viajan en el finalize; los informes ya las consumen y renderizan `[CODE: services/leia/prompts.ts behaviorBlock; app/entrevistas/[id]/informe/page.tsx:232-246]`. Configurable por puesto: `JobPreferences` gana flag de análisis **default ON** `[USR]`. `[CHG]`
- **Nuevo Outcome G — Puesto desde formulario:** el reclutador crea un puesto cargando título, descripción, conocimientos y metadata (ubicación, salario, modalidad, vacantes, estado de búsqueda, fecha de publicación); leIA estructura stack/seniority/responsabilidades desde el texto (`structureJob`). Completa la feature iniciada en `fromForm.ts` `[CODE: services/jobs/fromForm.ts (develop)]`. `[CHG]` `[USR: completar, no eliminar]`
- **Nuevo Outcome H — CV en el contexto de leIA:** el candidato puede tener un CV (PDF subido); el texto extraído entra al contexto de `firstQuestion`/`evaluate` y leIA referencia contenido real del CV en la conversación. `[CHG]` `[USR: upload PDF + extracción simple]`
- **Nuevo Outcome I — Informe compartible:** el reclutador genera un link público de solo lectura del informe (token firmado — primer uso real del `JWT_SECRET` ya configurado `[CODE: backend/src/config.ts:15]`). `[CHG]`
- **Nuevo Outcome J — Avatar con estados:** el avatar de la sala nativa refleja escuchando/pensando/hablando con animación audio-reactiva sobre los videos existentes `[CODE: backend/assets/ (develop)]`; el tier premium (HeyGen/Simli) queda como punto de integración con feature-flag, sin contratar. `[CHG]` `[DOC: PROPUESTA §7-bis]`
- **Nuevo Outcome K — Resiliencia por tiers:** cadena de degradación en sala nativa: Gemini Live API → pipeline GA (Chirp 3 STT + TTS actual) → Edge/mock; la entrevista nunca se cae por proveedor (extiende el Outcome 5 del snapshot). `[CHG]` `[DOC: INVESTIGACION §Impacto]`

---

## 3. Outcomes Modificados

| ID en snapshot | Outcome actual | Outcome nuevo | Tipo de cambio |
|---|---|---|---|
| Outcome 1 | Puesto estructurado solo desde link | Puesto desde link **o desde formulario** (Outcome G) | Extensión |
| Outcome 3 | Bot habla vía output_audio/bot-stage WS con TTS por oración | Igual en canal Meet; en sala nativa el audio primario pasa a ser el stream del Live API (el pipeline actual queda de fallback) | Modificación parcial |
| Outcome 9 | Demo sin costo (todo mock, memoria) | El modo demo-mock se conserva como fallback técnico, pero **la demo comercial corre con Postgres real y drivers pagos** `[USR]` | Clarificación |
| Outcome 10 | Sala nativa: candidato entra con el link y la entrevista arranca con `ready` | Se antepone el lobby (Outcome A): `ready` se emite recién tras consentimiento y chequeo de dispositivos | Modificación parcial |

---

## 4. Outcomes Obsoletos (regresiones intencionales)

| ID en snapshot | Outcome obsoleto | Justificación |
|---|---|---|
| Parte de Outcome 10 | Entrada directa a la sala sin pantalla previa (el WS se conecta apenas carga la página) | Reemplazado por el lobby con consentimiento; requisito legal/ético para el análisis de comportamiento `[USR]` |
| AC06 (parte browser) | En modo browser los captions del candidato se procesan aun mientras leIA habla, pero **sin interrumpir el audio** | Reemplazado por barge-in real: hablar durante el audio de leIA ahora lo corta (Outcome B) |

Ninguna otra regresión: el canal Meet conserva íntegro su comportamiento actual (half-duplex incluido).

---

## 5. Cambios en Restricciones / Constraints

- **Nueva restricción — proveedor primario de voz (sala nativa):** Gemini Live API, modelo generación 3.x Flash Live. Estado **Preview sin SLA** → obligatoria la cadena de fallback del Outcome K. Límites conocidos: ~15 min de audio por sesión sin compresión de contexto y ~10 min por conexión → **implementar session resumption + context window compression** para entrevistas de 20+ min. `[CHG]` `[DOC: INVESTIGACION §1]`
- **Nueva restricción — costos por entrevista (tier default):** objetivo ≈ USD 0.30–0.40 en sala nativa y ≈ USD 0.50–0.60 en Meet; el tier premium (avatar foto-realista) suma USD 2–4 y va tras feature-flag. `[CHG]` `[DOC: PROPUESTA §7-bis]`
- **Nueva restricción — consentimiento:** ninguna señal de cámara se captura sin consentimiento explícito en el lobby; el flag por puesto (default ON) habilita la *solicitud*, el consentimiento habilita la *captura*. Presentación en informes como "señales, no veredictos" (los prompts existentes ya siguen ese tono `[CODE: prompts.ts:106,131]`). `[CHG]` `[USR]`
- **Nueva restricción — modelo de datos `Job`:** se agregan campos top-level `publishedAt`, `location`, `salary`, `vacancies`, `modality`, `hiringStatus` y tipos `JobModality`, `JobHiringStatus` (los que `fromForm.ts` ya referencia `[CODE: services/jobs/fromForm.ts (develop)]`), con columnas en `jobs` + mapping en `postgres.ts`. `[CHG]`
- **Nueva restricción — `LeiaService` crece:** operación `structureJob(input) → {stack, seniority, yearsOfExperience, responsibilities, niceToHave}` implementada en los 3 drivers (mock/gemini/claude), con el patrón de fallback existente. `[CHG]`
- **Restricción modificada — persistencia:** el snapshot documenta que `Interview.mode` no se persiste en Postgres (hallazgo §8.3.3); pasa a ser obligatorio persistirlo (columna + CHECK + mapping, patrón `ADD COLUMN IF NOT EXISTS` ya usado para `tts_driver` `[CODE: db/schema.sql:68-82]`). La demo corre con `DATABASE_DRIVER=postgres` `[USR]`. `[CHG]`
- **Restricción mantenida a re-validar:** el guard anti-repetición y los pisos/techos de cierre del engine deben seguir aplicando cuando la conversación fluye por Live API (la evaluación por turno sigue siendo responsabilidad del arnés, no del canal de voz). `[CHG: clarificación]`
- **Restricción de seguridad diferida (aceptada para la demo):** `NEXT_PUBLIC_ADMIN_TOKEN` en el bundle y endpoints públicos de sala (snapshot INFER-07/08) NO se corrigen en estas etapas; quedan como puntos de integración comentados (T18). El link compartible de informe (Outcome I) NO debe depender del token admin. `[CHG: clarificación]` `[USR: propuesta §4 aprobada]`

**Checklist NFR:** concurrencia: demo = pocas entrevistas simultáneas; los buses/engines en memoria de proceso se aceptan (snapshot §9) → gap CHG-INFER-06. Performance: objetivo de latencia en Outcome C, medir en T07. Auditoría: sin cambios (solo jobs loguea) → gap CHG-INFER-07. Permisos: sin cambios salvo link firmado de informe. Fallo de integraciones: Outcome K. Migración: columnas nuevas con `IF NOT EXISTS`, sin datos productivos que migrar.

---

## 6. Cambios en Decisiones de Diseño / Integración

- **Reutilizar — contratos del arnés:** `LeiaService` `[CODE: services/leia/index.ts:65]`, `RecallService` `[CODE: services/recall/index.ts]`, `TTSService` `[CODE: services/tts/index.ts]`, buses WS con buffer/handshake (`botStageBus`, `browserSalaBus`) `[CODE: realtime/bot-stage.ts; realtime/browser-sala.ts]`, `analytics.ts`, `InterviewEngine` + registry. Todo lo nuevo entra como drivers/estados detrás de estos contratos. `[CHG]`
- **Componente nuevo — driver de canal de voz Live (sala nativa):** integra Gemini Live API (WebSocket bidireccional) al engine; responsabilidades: streaming de audio candidato→modelo y modelo→sala, barge-in, session resumption/compresión, y sincronización con el ciclo de turnos/evaluación del engine. Decisión de diseño fino (¿implementa `RecallService`+`LeiaService` combinados o un contrato nuevo `VoiceChannel`?) **diferida al Arquitecto**. `[CHG]`
- **Componente nuevo — cola de susurro:** buffer de sugerencias del reclutador en el engine, consumida al armar el próximo `askQuestion`. `[CHG]`
- **Componente nuevo — extracción de CV:** upload PDF (límite de tamaño a definir por el Arquitecto), extracción de texto plano, persistencia junto al candidato (`cvUrl` ya existe `[CODE: types.ts:46]`; falta el storage del archivo y el texto extraído). `[CHG]`
- **Componente nuevo — links firmados de informe:** token JWT firmado con `JWT_SECRET` (dep `@fastify/jwt` ya declarada `[CODE: backend/package.json]`), ruta pública de solo lectura. `[CHG]`
- **Integración externa nueva:** Gemini Live API (contratar tier pago de Gemini API; preview). HeyGen/Simli **NO se contratan**: solo queda el punto de montaje con feature-flag. `[CHG]` `[DOC: INVESTIGACION]`
- **Componente removido:** ninguno. `generateMeetUrl()` y los componentes huérfanos del snapshot (INFER-01/03) quedan fuera del alcance de estas etapas (limpieza diferida). `[OBS: no aplica]`

---

## 7. Desglose de Tareas para el Cambio (Task Breakdown)

### Etapa 0 — Saneo y prerrequisitos (bloqueante de todo)

#### T01 — Integrar los branches en vuelo
- **Descripción:** mergear `origin/develop` (`eb6e489`) y `origin/feature/sala-nativa` (`fa9a386`) a `main`. Historia lineal, sin conflictos posibles (snapshot §0).
- **Depende de:** Ninguna.
- **Criterio de finalización:** `main` contiene ambos branches; `git log` lineal; el repo refleja la base asumida por el snapshot.

#### T02 — Completar la feature "puesto desde formulario"
- **Descripción:** agregar tipos `JobModality`/`JobHiringStatus` y campos top-level de `Job` (`publishedAt`, `location`, `salary`, `vacancies`, `modality`, `hiringStatus`) en `types.ts` backend y frontend; columnas en `schema.sql` + mapping en `postgres.ts` (y passthrough en `memory.ts`); implementar `structureJob()` en `LeiaService` y sus 3 drivers (mock heurístico reutilizando `detectStack`/`detectSeniority` de `fromLink.ts` `[CODE: services/jobs/fromLink.ts:144-158]`; gemini y claude con prompt JSON estricto y parsers defensivos como los existentes); crear ruta `POST /api/jobs/from-form` (validación Zod) que use `buildJobFromForm` `[CODE: services/jobs/fromForm.ts (develop)]`; formulario en frontend (extender `/puestos/nuevo` con pestañas "desde link" / "desde formulario").
- **Reutiliza:** `fromForm.ts` existente como base; patrón de rutas y validación de `routes/jobs.ts`.
- **Depende de:** T01.
- **Criterio de finalización:** `tsc` compila sin errores en backend (hoy falla por este archivo); un puesto creado por formulario aparece en `/puestos` y sirve para agendar entrevistas.

#### T03 — Persistir `Interview.mode` y flag de análisis en Postgres
- **Descripción:** columna `mode` (`meet|browser`, CHECK, default `meet`) con `ADD COLUMN IF NOT EXISTS` + mapping en INSERT/UPDATE/row-mapper de `postgres.ts`; agregar flag de análisis de comportamiento a `JobPreferences` (JSONB existente, sin migración) con default ON.
- **Reutiliza:** patrón de migración idempotente de `tts_driver` `[CODE: db/schema.sql:68-82]`.
- **Depende de:** T01.
- **Criterio de finalización:** con `DATABASE_DRIVER=postgres`, una entrevista `browser` sobrevive al reinicio del backend y `GET /api/sala/:id/info` responde 200.

#### T04 — Verificación end-to-end sobre Postgres + actualización de README/SETUP
- **Descripción:** correr el flujo completo (ambos modos) con Postgres; actualizar README/SETUP resolviendo los 9 conflictos del snapshot §8.2 (TTS reales, transcripción, sala, endpoints, etc.).
- **Depende de:** T02, T03.
- **Criterio de finalización:** demo reproducible desde cero con `docker compose up` + seed; README sin las divergencias listadas.

### Etapa 1 — Wow candidato (sala nativa)

#### T05 — Lobby del candidato
- **Descripción:** pantalla previa en `/sala/:id`: chequeo de dispositivos, contexto del puesto (de `GET /api/sala/:id/info` `[CODE: realtime/browser-sala.ts]`), consentimiento de grabación y de análisis (dos checks separados); el WS emite `ready` solo al confirmar. El consentimiento de análisis viaja al backend y se persiste en la entrevista.
- **Depende de:** T04.
- **Criterio de finalización:** AC-NEW-01 y AC-NEW-02 verdes.

#### T06 — Driver Gemini Live API (voz primaria de la sala)
- **Descripción:** integrar Live API como canal de voz de la sala nativa detrás de los contratos del arnés (diseño fino: Arquitecto): audio bidireccional, barge-in nativo, session resumption + compresión de contexto para superar 15 min, y sincronización con el ciclo del engine (turnos, evaluación por turno con el driver leIA actual, muletillas ya no necesarias en este camino).
- **Reutiliza:** `browserSalaBus` para el transporte sala↔backend; `GEMINI_API_KEY` existente.
- **Depende de:** T05.
- **Criterio de finalización:** AC-NEW-03 y AC-NEW-04 verdes; latencia medida y registrada.

#### T07 — Cadena de fallback de voz
- **Descripción:** ante fallo del Live API (error de conexión/cuota/preview), degradar en runtime al pipeline actual (Web Speech/STT + TTS Gemini→Edge→mock) sin cortar la entrevista, siguiendo el patrón de fallbacks existente `[CODE: services/tts/gemini.ts (develop); services/leia/index.ts]`. Barge-in en el camino fallback: pausar `<audio>` + descartar cola TTS + estado `interrupted` en el engine.
- **Depende de:** T06.
- **Criterio de finalización:** AC-NEW-05 verde (simulando caída del proveedor).

#### T08 — Avatar audio-reactivo con estados
- **Descripción:** animación de la sala según estado (escuchando/pensando/hablando) modulada por la amplitud del audio; reutiliza los mp4 existentes `[CODE: backend/assets/ (develop)]`; deja el punto de montaje del avatar premium (HeyGen/Simli) tras feature-flag comentado, sin contratar.
- **Depende de:** T05.
- **Criterio de finalización:** los 3 estados son visualmente distinguibles en demo; flag premium documentado.

#### T09 — CV del candidato en el contexto de leIA
- **Descripción:** upload de PDF en alta/edición de candidato, extracción simple de texto, persistencia del texto, e inclusión en los prompts de `firstQuestion`/`evaluate` (truncado; presupuesto de tokens a definir por Arquitecto).
- **Reutiliza:** `cvUrl` y `notes` existentes `[CODE: types.ts:41-50]`; patrón de prompts de `prompts.ts`.
- **Depende de:** T04.
- **Criterio de finalización:** AC-NEW-06 verde.

### Etapa 2 — Wow reclutador

#### T10 — Sala de observación en vivo
- **Descripción:** página `/entrevistas/:id/live` consumiendo `WS /ws/interview/:id` `[CODE: realtime/interview-ws.ts]`: transcripción en vivo, pregunta actual, estado de leIA, radar de dimensiones incremental, flags, score corriente.
- **Reutiliza:** el WS existente sin cambios de backend (o mínimos); componentes `RadarChart`/`ScoreBar` existentes `[CODE: frontend/components/]`.
- **Depende de:** T04 (funciona para ambos canales).
- **Criterio de finalización:** AC-NEW-07 verde en modo browser y en modo meet.

#### T11 — Susurro del reclutador
- **Descripción:** input en la sala de observación → mensaje WS `suggest_question` → cola en el engine → leIA formula la sugerencia con su estilo en el próximo turno (pasa por `findSimilarQuestion`).
- **Depende de:** T10.
- **Criterio de finalización:** AC-NEW-08 verde.

#### T12 — Señales de comportamiento conectadas
- **Descripción:** montar `useFaceAnalysis` `[CODE: frontend/lib/useFaceAnalysis.ts]` en la sala nativa (solo con flag del puesto ON y consentimiento OK), acumular `BehavioralAnalysis` + señal de pérdida de foco de pestaña, y enviarlo al finalizar (el endpoint y el pipeline de informes ya lo aceptan `[CODE: routes/interviews.ts:141-144; prompts.ts behaviorBlock]`).
- **Depende de:** T05.
- **Criterio de finalización:** AC-NEW-09, AC-NEW-10 y AC-NEW-11 verdes.

#### T13 — Informe compartible
- **Descripción:** ruta pública `GET /api/reports/shared/:token` (JWT firmado con `JWT_SECRET`, expiración, solo lectura) + botón "Compartir" en el informe + vista pública sin token admin; export imprimible (print CSS).
- **Depende de:** T04.
- **Criterio de finalización:** AC-NEW-12 verde.

### Etapa 3 — Clase ejecutiva y cierre de demo

#### T14 — Pulido del canal Meet
- **Descripción:** estados de ingreso del bot en el detalle de entrevista ("leIA está entrando…", de los eventos lifecycle ya emitidos `[CODE: services/recall/real.ts ingestWebhook]`); verificación de que sala de observación y susurro funcionan igual en meet; matriz de capacidades por canal en README.
- **Depende de:** T10, T11.
- **Criterio de finalización:** demo completa reproducible en un Meet real con la sala de observación al lado.

#### T15 — Puntos de integración del producto real (comentados)
- **Descripción:** dejar previstos sin construir (comentario `// INTEGRACIÓN:` + interfaces/stubs): authPlugin JWT multi-tenant, `RecordingStore` (Log/S3), webhook saliente `interview.completed`, campos `telemetry` (latencias/tokens por turno) para agent-evals y metering, selector de idioma. `[DOC: PROPUESTA §4]`
- **Depende de:** T04.
- **Criterio de finalización:** los 7 puntos de la propuesta §4 localizables por grep `INTEGRACIÓN:`.

#### T16 — Seed y guion de demo
- **Descripción:** seed con puesto/candidato realistas (incluye CV de ejemplo), y documento del guion de demo (10 pasos de la propuesta §2) con checklist pre-demo (tunnel, API keys, Postgres).
- **Depende de:** todo lo anterior.
- **Criterio de finalización:** una persona que no participó del desarrollo ejecuta la demo completa siguiendo el guion.

---

## 8. Nuevos Criterios BDD / Modificados / Obsoletos

### 8.1 Nuevos criterios (a-priori)

#### AC-NEW-01 — Lobby: la entrevista no arranca sin consentimiento
- **Dado:** entrevista `browser` agendada para la candidata Ana Pérez, puesto "Frontend React Senior" con análisis de comportamiento ON.
- **Cuando:** Ana abre `/sala/:id`, permite cámara/micrófono, pero NO confirma el lobby.
- **Entonces:** la entrevista sigue `agendada` (no se emite `ready`), y leIA no habla.
- **Origen:** [USR: decisión de lobby + consentimiento, sesión 2026-07-06]

#### AC-NEW-02 — Consentimiento parcial: sin análisis, la entrevista corre igual
- **Dado:** mismo escenario, Ana acepta grabación pero RECHAZA el análisis de comportamiento.
- **Cuando:** confirma el lobby y completa la entrevista de 6+ turnos.
- **Entonces:** la entrevista se desarrolla normal; el finalize NO incluye `behavior`; el informe muestra "Análisis por cámara: no disponible" (comportamiento actual del prompt `[CODE: prompts.ts:214]`).
- **Origen:** [USR]

#### AC-NEW-03 — Barge-in nativo (Live API)
- **Dado:** entrevista en sala nativa con driver Live activo; leIA lleva >2 s hablando una pregunta.
- **Cuando:** Ana empieza a hablar ("perdón, ¿te referís a experiencia laboral?").
- **Entonces:** el audio de leIA se corta en <500 ms, lo dicho por Ana se procesa como habla del turno, y leIA responde a la interrupción sin repetir la pregunta completa.
- **Origen:** [DOC: INVESTIGACION §1 — capacidad nativa del Live API] [USR: momento wow #1 de la demo]

#### AC-NEW-04 — Sesión Live de 20+ minutos
- **Dado:** entrevista con `durationMinutes=20` en sala nativa con Live API.
- **Cuando:** la conversación supera los 15 minutos de audio y/o los 10 minutos de conexión.
- **Entonces:** la sesión continúa sin corte perceptible (resumption/compresión), y los turnos posteriores se siguen evaluando y persistiendo.
- **Origen:** [DOC: INVESTIGACION §1 — límites documentados del Live API]

#### AC-NEW-05 — Degradación sin caída
- **Dado:** entrevista en curso por Live API, turno 4.
- **Cuando:** el Live API devuelve error irrecuperable (simulado: cuota agotada / WS cerrado).
- **Entonces:** dentro del mismo turno o el siguiente, la sala pasa al pipeline de fallback (STT navegador/GA + TTS actual), leIA sigue la entrevista, y el informe final se genera igual. Ningún estado queda `error`.
- **Origen:** [USR: filosofía de fallbacks existente extendida] [DOC: PROPUESTA §3.1]

#### AC-NEW-06 — leIA usa el CV real
- **Dado:** candidata Ana con CV PDF subido cuyo texto incluye "3 años en MercadoLibre como frontend".
- **Cuando:** arranca la entrevista.
- **Entonces:** dentro de los primeros 3 turnos leIA hace al menos una referencia verificable al contenido del CV (p. ej. menciona MercadoLibre o los 3 años), no genérica.
- **Origen:** [USR: upload PDF + extracción simple, sesión 2026-07-06]

#### AC-NEW-07 — Sala de observación en vivo
- **Dado:** entrevista `en_curso` (cualquier canal); el reclutador abre `/entrevistas/:id/live`.
- **Cuando:** Ana responde y leIA evalúa (evento `leia_evaluation_ready`).
- **Entonces:** en <2 s la vista muestra el fragmento nuevo de transcripción, el score del turno y el radar actualizado, sin refrescar la página.
- **Origen:** [DOC: PROPUESTA §3.2-A] [CODE: interview-ws.ts ya emite los eventos]

#### AC-NEW-08 — Susurro incorporado con estilo
- **Dado:** sala de observación abierta, turno 5 en curso.
- **Cuando:** el reclutador envía la sugerencia "preguntale por qué dejó su último trabajo".
- **Entonces:** la siguiente pregunta de leIA aborda ese tema formulado con su voz/estilo (no texto literal), se marca como sugerida en la vista del reclutador, y no se repite si ya se había preguntado (guard existente).
- **Origen:** [DOC: PROPUESTA §3.2-B] [USR]

#### AC-NEW-09 — Señales de comportamiento llegan al informe
- **Dado:** entrevista en sala nativa con análisis ON y consentido; Ana mira hacia abajo de forma sostenida ~30 % del tiempo (simulable).
- **Cuando:** se genera el Informe 2.
- **Entonces:** `behavioralObservations` menciona la mirada baja con porcentaje, `suspectedReading=true` (umbral >25 % ya definido `[CODE: prompts.ts:131]`), y el informe lo presenta como señal a revisar, no como veredicto.
- **Origen:** [USR: ON por defecto + "señales, no veredictos"]

#### AC-NEW-10 — Flag por puesto apaga la captura
- **Dado:** puesto "Backend Node Semi" con el flag de análisis en OFF.
- **Cuando:** un candidato completa la entrevista en sala nativa.
- **Entonces:** el lobby no pide consentimiento de análisis, no se carga face-api, y el informe no contiene sección de comportamiento.
- **Origen:** [USR: desactivable por puesto]

#### AC-NEW-11 — Pérdida de foco registrada
- **Dado:** entrevista en sala nativa con análisis ON y consentido.
- **Cuando:** Ana cambia de pestaña 3 veces durante respuestas.
- **Entonces:** el `BehavioralAnalysis` final registra los eventos de pérdida de foco y el informe los menciona entre las observaciones.
- **Origen:** [USR: propuesta §3.2-C aprobada]

#### AC-NEW-12 — Link compartible sin credenciales
- **Dado:** informe generado de la entrevista de Ana; el reclutador toca "Compartir".
- **Cuando:** un tercero abre el link en un navegador sin ningún token admin.
- **Entonces:** ve el informe completo en solo lectura; con el token vencido o alterado recibe 401/410; el link NO expone otras rutas de la API.
- **Origen:** [USR] [DOC: PROPUESTA §3.2-D]

#### AC-NEW-13 — Puesto desde formulario estructurado por leIA
- **Dado:** el reclutador completa el formulario: título "SSR Fullstack", empresa "Acme", descripción libre que menciona "React, Node y Postgres", conocimientos "APIs REST, testing", ubicación "Mendoza", modalidad remota, 2 vacantes.
- **Cuando:** envía `POST /api/jobs/from-form`.
- **Entonces:** se crea el Job con `stack` conteniendo React/Node/PostgreSQL, `seniority='semi'`, metadata persistida (visible en el detalle del puesto), y sirve para agendar una entrevista; con `LEIA_DRIVER=mock` el resultado es determinista (heurística).
- **Origen:** [USR: completar la feature, sesión 2026-07-06] [CODE: fromForm.ts como contrato base]

#### AC-NEW-14 — `mode` sobrevive a Postgres
- **Dado:** `DATABASE_DRIVER=postgres`; entrevista creada con `mode='browser'`.
- **Cuando:** se reinicia el backend y Ana abre `/sala/:id`.
- **Entonces:** `GET /api/sala/:id/info` responde 200 con los datos del puesto (hoy respondería 404 — snapshot §8.3.3).
- **Origen:** [USR: demo con Postgres real] [CODE: db/postgres.ts:164,191 — evidencia del hueco]

#### AC-NEW-15 — El build compila (fromForm saneado)
- **Dado:** `main` con los branches integrados (T01) y T02 completada.
- **Cuando:** `npm run build --workspace=backend`.
- **Entonces:** `tsc` termina sin errores (hoy fallaría por los tipos inexistentes de `fromForm.ts` — snapshot §8.3.2).
- **Origen:** [CODE: git show origin/develop:backend/src/services/jobs/fromForm.ts]

### 8.2 Criterios modificados

| ID en snapshot | Texto actual | Texto nuevo | Motivo |
|---|---|---|---|
| AC06 | En modo browser los captions del candidato se procesan aunque leIA hable (sin bloquear) | Además de procesarse, el habla del candidato **interrumpe** el audio de leIA (barge-in, AC-NEW-03) | Outcome B |
| AC13 | La sala arranca sola con `ready` al conectarse | `ready` se emite recién tras lobby + consentimiento (AC-NEW-01) | Outcome A |
| AC01 | Demo end-to-end sin claves (mock + memoria) | Se conserva como criterio del modo fallback técnico; la demo comercial corre con Postgres + drivers pagos | Decisión [USR] |

### 8.3 Criterios obsoletos

| ID en snapshot | Criterio obsoleto | Acción al ejecutar el cambio |
|---|---|---|
| — | Ninguno se elimina por completo | Los AC modificados arriba reemplazan a sus versiones del snapshot |

---

## 9. Impacto Esperado en el Snapshot

| Sección del Snapshot | Impacto |
|---|---|
| 1. Contexto de Negocio | Modificado: se agrega el actor "candidato como cliente del reclutador" y el objetivo demo-vendible (propuesta §0) |
| 2. Outcomes | Extendido con A-K; modificados 1, 3, 9, 10 (ver §2-3 de este MD) |
| 3. Scope Boundaries | Salen de out-of-scope: captura de comportamiento, consumo del WS observador, persistencia parcial de grabación (sube igual, storage sigue diferido). Siguen fuera: creación automática del Meet, multiusuario/roles, notificaciones, IA propia |
| 4. Constraints | Modificado: ver §5 (proveedor primario, límites Live API, consentimiento, modelo Job, costos) |
| 5. Decisiones Previas | Modificado: ver §6 (nuevos componentes detrás de los mismos contratos) |
| 6. Task Breakdown | N/A en snapshot; ver §7 de este MD (T01-T16) |
| 7. Criterios BDD | 15 nuevos, 3 modificados; ver §8 |
| 8. Gaps | Se RESUELVEN con este cambio: §8.3.2 (fromForm → T02), §8.3.3 (mode → T03), INFER-02 (behavior sin productor → T12), INFER-06 (WS sin consumidor → T10), CONFLICT-01..09 de README (→ T04). Siguen ABIERTOS y aceptados: INFER-07/08 (seguridad de token y endpoints públicos — diferidos a producto, T15 los deja comentados), INFER-01/03/04/05 (huérfanos y deps vestigiales — limpieza diferida) |

---

## 10. Gaps específicos del cambio

| ID | Afirmación / Pendiente | Razón / Acción esperada |
|---|---|---|
| CHG-INFER-01 | Contrato exacto del Gemini Live API (formato de eventos, config de resumption/compresión, cuotas del tier pago) no verificado contra código propio — solo docs públicas | Arquitecto/Implementador: spike técnico de 1 día al inicio de T06 (la propuesta §7.1 ya lo preveía) |
| CHG-INFER-02 | Disponibilidad de voz española rioplatense (o neutra aceptable) en Live API y Chirp 3 HD sin confirmar | Validar en el spike de T06; fallback: Edge `es-AR-ElenaNeural` ya operativa `[CODE: services/tts/edge.ts:30]` |
| CHG-INFER-03 | Diseño del encaje Live API ↔ engine (¿quién es dueño del turno cuando el canal es full-duplex? ¿la evaluación por turno sigue llamando al driver leIA de texto?) | Decisión del Arquitecto en el Plan Ejecutor (insumo: §6 de este MD) |
| CHG-INFER-04 | Librería de extracción de texto PDF y límites (tamaño máx, PDFs escaneados sin OCR) sin definir | Arquitecto: elegir lib estándar; PDFs-imagen quedan fuera (extracción "simple" [USR]) |
| CHG-INFER-05 | Almacenamiento del archivo CV (disco local vs S3) para la demo | Sugerido: disco local con interface `FileStore` alineada al punto de integración `RecordingStore` (T15) |
| CHG-INFER-06 | Buses/engines en memoria de proceso: una demo con reinicio a mitad de entrevista la pierde | Riesgo aceptado para demo (snapshot §9); refactor diferido a producto |
| CHG-INFER-07 | Auditoría de operaciones nuevas (susurro, consentimiento, compartir informe) no definida | Mínimo sugerido: registrar consentimiento y compartidos en `audit_logs` (tabla ya existe); confirmar con el Arquitecto |
| CHG-INFER-08 | Presupuesto de tokens del texto de CV en prompts (truncado) sin definir | Arquitecto define límite (sugerido: ~2-3k caracteres, coherente con truncados existentes en prompts.ts) |
| CHG-INFER-09 | "Medición de latencia" del Outcome C: método y umbral de aceptación exactos | Definir en T06 (log de timestamps por turno; el campo `telemetry` de T15 es el destino natural) |

---

## 11. Indicaciones para el Arquitecto SDD

- Leer este MD **junto con el snapshot** `ENTREVISTADOR_IA_LEIA_ELICITADOR_MODO-D_v1.0.md` y los dos documentos fuente (propuesta + investigación): contienen el guion de demo (norte funcional) y el racional de proveedores.
- **T01-T03 son el camino crítico absoluto**: nada compila ni persiste correctamente sin ellos (snapshot §8.3.2/8.3.3).
- La decisión de diseño más gruesa es CHG-INFER-03 (encaje Live API ↔ `InterviewEngine`): definirla antes de estimar la Etapa 1; el spike CHG-INFER-01 debería ser la primera tarea del plan ejecutor de esa etapa.
- **Cobertura de tests del snapshot: nula.** Riesgo alto de regresión al tocar el engine. Recomendación: exigir en el plan ejecutor tests del engine (commit por silencio, barge-in/interrupted, cola de susurro, fallback de voz) — vitest ya está declarado y sin usar `[CODE: backend/package.json]`.
- Hallazgos de seguridad del snapshot (INFER-07/08) NO se sanean en estas etapas por decisión del PO, pero el link compartible (T13) no debe agravarlas: el token firmado debe dar acceso a UN informe, no a la API.
- Los outcomes obsoletos (§4) son dos y acotados: entrada directa a la sala y no-interrupción del audio en browser — verificar que la sala del branch no tenga dependencias del comportamiento previo.
- Orden sugerido de planes ejecutores: uno por etapa (0, 1, 2, 3), con demo interna al cierre de cada una (la propuesta §6 trae el calendario de referencia: 2-18 días).

---

## CHANGELOG

- v1.0 (2026-07-06): Versión inicial de cambios propuestos sobre snapshot v1.0. Criterios nuevos: 15 (+3 modificados). Tareas: 16 (en 4 etapas). Gaps del cambio: 9. Decisiones del PO incorporadas: facial ON default desactivable, completar fromForm, demo con Postgres real, CV upload PDF + extracción simple, tiers §7-bis.
