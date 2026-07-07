# Entrevistador IA leIA (PoC end-to-end) — Especificación SDD

## 0. Metadatos del Contrato

- **ID Ticket:** N/A (sin ticket asociado; el analista declaró que el README es la línea de base)
- **Versión del contrato:** v1.0
- **Fecha:** 2026-07-06
- **Modo de elicitación:** D — Reconstruido desde código (ingeniería inversa)
- **Nivel de confianza recomendado para el destinatario:** Medio
- **Fase actual:** ELICITACIÓN
- **Producida por:** Ingeniero de Requisitos SDD con acceso a código (skill ing-requisitos-sdd)
- **Próximo destinatario:** Agente Arquitecto / Documentación viva del sistema (base para las mejoras a definir)
- **Alcance:** Flujo end-to-end de la PoC "entrevistador por IA": alta de puesto/candidato/entrevista → entrevista por voz conducida por leIA (modo Meet con bot Recall.ai y modo sala nativa en browser) → generación y visualización de Informes 1 y 2.
- **Entry point (si flujo):** `POST /api/interviews/:id/start` (`backend/src/routes/interviews.ts:111`) para modo meet; mensaje WS `{type:'ready'}` en `/ws/sala/:id` (`backend/src/realtime/browser-sala.ts`, branch) para modo browser.
- **Base de código asumida:** por decisión del analista `[USR]`, la spec asume **main + origin/develop + origin/feature/sala-nativa integrados**. La historia es lineal (`main @ 0686437` ⊂ `develop @ eb6e489` ⊂ `feature/sala-nativa @ fa9a386`), así que la base efectiva es **`origin/feature/sala-nativa @ fa9a386`** y no hay conflictos de merge posibles entre los tres. ATENCIÓN: el working tree local está en `main`; los dos branches están **sin mergear** y develop introduce un archivo que rompe la compilación (ver 8.3).
- **Fuentes consultadas:** README.md, SETUP.md, .env.example, docker-compose.yml, render.yaml, package.json (raíz, backend, frontend); backend/src completo en main (`server.ts`, `config.ts`, `types.ts`, `db/*`, `routes/*`, `realtime/*`, `services/leia/*`, `services/recall/*`, `services/tts/*`, `services/interview/*`, `services/jobs/fromLink.ts`); frontend (`lib/api.ts`, `lib/types.ts`, `lib/useVoice.ts`, `lib/useFaceAnalysis.ts`, `app/entrevistas/[id]/page.tsx`, `app/entrevistas/[id]/informe/page.tsx`, `app/entrevistas/nueva/page.tsx`, componentes); en branches: `git diff main..origin/feature/sala-nativa` completo + lectura íntegra de `services/recall/browser.ts`, `realtime/browser-sala.ts`, `services/jobs/fromForm.ts`, `app/sala/[id]/page.tsx` @ `fa9a386`.
- **Tests ejecutados:** Ninguno - solo lectura (política definida en Fase 1). No existen tests automatizados en el repo.
- **NotebookLM consultado:** No - sesión solo código. El README/SETUP del repo se trataron como documentación local: sus divergencias con el código se marcan `[CONFLICT]`.
- **Ticket leído:** No (no existe).
- **Contexto de negocio declarado (Fase 1):** el analista remitió al README como línea de base: entrevistas automáticas de selección en Google Meet con IA propia (leIA), objetivo de costo ~USD 0.22 por entrevista de 20 min y confidencialidad de datos de candidatos (`[DOC: README.md §Costos]`). Actores no declarados explícitamente; se infieren reclutador/administrador y candidato.
- **Limitaciones de acceso:** ninguna (monorepo autocontenido). No se ejecutó el sistema ni se consultó una BD real.
- **Asunciones explícitas:** (1) la base asumida incluye develop y sala-nativa `[USR]`; (2) el README manda como intención pero el código gana como estado actual `[USR]`; (3) origen de los componentes huérfanos del frontend y del pipeline BehavioralAnalysis: el analista no sabe → quedan como inferencias opacas `[USR: "no sé"]`.
- **Decisiones diferidas al Arquitecto:** merge y saneo de branches (incluido `fromForm.ts` roto); migración de `mode` a Postgres; estrategia de auth real (hoy token estático expuesto al browser); persistencia de grabaciones; destino del código huérfano; actualización del README.

---

## 1. Contexto de Negocio y Viaje de Usuario (User Journey)

- **Historia de Usuario reconstruida:** "Como **reclutador**, quiero que **leIA entreviste por voz a un candidato** (en un Google Meet real o en una sala web propia) evaluando cada respuesta contra el puesto, para **obtener sin intervención humana un informe con scoring, analítica y recomendación** que me permita decidir si avanza." (rol y beneficio inferidos del código y del README `[DOC: README.md §Qué hay adentro]`, no declarados formalmente).

- **Descripción del Flujo (estado actual del código):**
  1. El reclutador crea un **puesto** desde el link de una oferta (`POST /api/jobs/from-link`): el backend baja el HTML y arma el Job por heurísticas (og-tags, stack conocido, seniority por regex), con preferencias default de entrevista (20 min, 6 dimensiones, ambos informes) `[CODE: backend/src/services/jobs/fromLink.ts:16-76]`.
  2. Crea un **candidato** (email único) `[CODE: backend/src/routes/candidates.ts:31-53]` y **agenda la entrevista** eligiendo modo: `meet` exige pegar una URL real `https://meet.google.com/...`; `browser` no requiere URL y genera un link de sala compartible `${FRONTEND_URL}/sala/:id` `[CODE: backend/src/routes/interviews.ts (branch, CreateInterviewSchema con refine por modo); frontend/app/entrevistas/[id]/page.tsx (branch)]`. La voz de leIA se elige por entrevista (`gemini` | `edge`), editable solo en estado `agendada` `[CODE: backend/src/routes/interviews.ts:93-109]`.
  3. **Modo meet:** al iniciar (`POST /api/interviews/:id/start`), el `InterviewEngine` genera la primera pregunta y muletillas en paralelo, pre-sintetiza el saludo, crea el bot en Recall.ai con `output_media` apuntando a la página `/bot-stage/:id` (avatar en video mp4 idle/hablando) y transcripción `recallai_streaming`; los eventos vuelven por webhook `POST /webhooks/recall/captions` `[CODE: backend/src/services/interview/engine.ts start(); backend/src/services/recall/real.ts:38-115]`.
  4. **Modo browser:** el candidato abre `/sala/:id`, la página pide cámara/micrófono, se conecta a `WS /ws/sala/:id` y manda `ready`; eso arranca el engine automáticamente. El reconocimiento de voz corre en el navegador (Web Speech API) y cada transcript viaja por WS al backend, que lo inyecta como caption `[CODE: backend/src/realtime/browser-sala.ts; frontend/app/sala/[id]/page.tsx (branch)]`.
  5. **Ciclo de turno:** las palabras finales del candidato alimentan un buffer; 700 ms sin captions nuevos disparan el commit. leIA evalúa (score + 6 dimensiones + flags + rationale), decide si pide aclaración (no avanza turno), sigue con otra pregunta (con guard anti-repetición Jaccard ≥ 0.6) o cierra (`shouldFinish` con piso de 6 turnos y techo por tiempo/16 turnos). Mientras "piensa", reproduce una muletilla pre-sintetizada. La respuesta de leIA se sintetiza **oración por oración** (sentence-streaming) para bajar la latencia percibida `[CODE: backend/src/services/interview/engine.ts commitAnswer(), askQuestion(), splitSentences() (develop)]`.
  6. **Fin:** manual (`POST /api/interviews/:id/finalize` o botón/`hangup` en la sala) o **automático** cuando el candidato corta el Meet / se cierra el WS de la sala (delay de 4 s por reconexiones). Se generan Informe 1 (narrativa + transcripción) e Informe 2 (scoring, radar, sentimiento/calidad — recalculados determinísticamente —, recomendación) `[CODE: engine.ts autoFinish()/stop()/generateReports(); backend/src/services/interview/analytics.ts]`.
  7. El reclutador ve **un informe único** en `/entrevistas/:id/informe` que combina el Informe 2 (principal) con la narrativa y transcripción del 1 `[CODE: frontend/app/entrevistas/[id]/informe/page.tsx:32-58]`.

---

## 2. Resultados Esperados (Outcomes)

- **Outcome 1 — Puesto estructurado desde un link:** dado un URL cualquiera, el sistema persiste un Job con título/empresa/descripción (query hints → og-tags → slug), stack detectado contra una lista conocida y seniority por regex; nunca falla por no poder bajar el HTML (fallback heurístico) `[CODE: backend/src/services/jobs/fromLink.ts:16-76]`.
- **Outcome 2 — Entrevista agendada con voz propia:** la entrevista queda `agendada` con `ttsDriver` (default `gemini`, o `edge` si `TTS_DRIVER=edge`) y, según modo, URL de Meet validada o sala propia `[CODE: backend/src/routes/interviews.ts:64-91,176-178]`.
- **Outcome 3 — Bot presente y hablando en el Meet:** en modo meet con driver real, existe un bot en la reunión cuyo video es la página bot-stage (avatar mp4) y cuyo audio sale por `output_audio` (MP3) o, si falla, por WS al bot-stage `[CODE: backend/src/services/recall/real.ts joinMeet()/playAudio() (develop)]`.
- **Outcome 4 — Conversación por turnos con evaluación persistida:** cada turno queda persistido (`interview_turns`) con su `Evaluation` (score 0-10, 6 dimensiones, flags, rationale) y la transcripción completa en `transcripts` `[CODE: engine.ts commitAnswer(); backend/src/db/schema.sql:87-131]`.
- **Outcome 5 — La entrevista nunca se corta por fallo de proveedor:** si Gemini/Claude fallan, leIA cae al mock heurístico; si Gemini TTS falla, cae a Edge TTS; si ElevenLabs falla, a mock; si `output_audio` falla, al WS del bot-stage `[CODE: services/leia/gemini.ts (catch → fallback); services/tts/gemini.ts (develop); services/recall/real.ts (develop)]`.
- **Outcome 6 — Finalización automática:** si el candidato abandona el Meet (`participant_events.leave`) o el bot reporta `left`, o si el WS de la sala nativa se cierra, la entrevista pasa a `completada` y los informes se generan solos `[CODE: engine.ts handleRecallEvent()/autoFinish(); realtime/browser-sala.ts on close (branch)]`.
- **Outcome 7 — Dos informes por entrevista, únicos por tipo:** Informe 1 y 2 según `Job.preferences.generateReport1/2`, con `UNIQUE (interview_id, kind)`; la distribución de calidad y el conteo de turnos analizados se calculan SIEMPRE de los scores reales, y el sentimiento del LLM se valida/normaliza con fallback objetivo `[CODE: engine.ts generateReports(); analytics.ts; db/schema.sql:136-145]`.
- **Outcome 8 — Recomendación accionable:** el Informe 2 concluye `avanzar` (≥7.5) / `segunda_instancia` (5.5-7.5) / `descartar` (<5.5) con razón; el criterio está tanto en el prompt como en el mock heurístico `[CODE: services/leia/prompts.ts LEIA_REPORT2_SYSTEM_PROMPT; services/leia/mock.ts buildReport2()]`.
- **Outcome 9 — Demo sin costo:** sin ninguna API key el sistema corre end-to-end (drivers mock + memoria); el health lo declara (`demoMode: true`) y el flujo se completa con `simulate-answer` `[CODE: backend/src/config.ts isDemoMode(); routes/interviews.ts:151-165]` `[DOC: README.md §Arrancar en 3 minutos]`.
- **Outcome 10 — Sala nativa autoservicio (branch):** el candidato con el link de la sala inicia la entrevista con solo conectarse (`ready`), conversa por voz sin Meet ni Recall, y puede grabarse localmente una composición canvas (leIA + PiP + audio mixeado) que se sube al backend al finalizar `[CODE: realtime/browser-sala.ts; frontend/app/sala/[id]/page.tsx (branch)]`.

---

## 3. Límites de Alcance (Scope Boundaries)

- **En Alcance (In-Scope):**
  - Todo el ciclo puesto → candidato → entrevista por voz → informes, en ambos modos (meet y browser), con los drivers descritos.
  - Selección de motor de IA, TTS, captación y BD por variables de entorno; selección de TTS por entrevista.
  - Auto-finalización y tolerancia a fallos de proveedores.
  - Contrato público de leIA fuera del flujo (`POST /api/leia/evaluate`, `/next-question`) `[CODE: backend/src/routes/leia.ts]`.

- **Fuera de Alcance (Out-of-Scope):**
  - **Creación automática de la reunión de Meet:** no hay integración con Google Calendar/Workspace; la URL se pega a mano (el generador `generateMeetUrl()` existe pero nadie lo llama) `[CODE: services/interview/meet.ts sin referencias entrantes]`.
  - **Captura de comportamiento por cámara:** `BehavioralAnalysis` tiene tipos, prompts y render, pero ningún código alcanzable lo produce; solo entraría por el body de `POST /api/interviews/:id/finalize` `[CODE: routes/interviews.ts:141-144; ausencia de callers de useFaceAnalysis]`.
  - **Multiusuario/roles/login:** un único token estático; no hay usuarios, sesiones ni permisos `[CODE: server.ts:54-66]`.
  - **Multi-candidato en la misma reunión:** `classifySpeaker` es binario bot/candidato por nombre del participante; un tercero se clasifica como candidato `[CODE: services/recall/real.ts:281-291]`.
  - **Persistencia de grabaciones:** `POST /api/sala/:id/recording` solo loguea los bytes recibidos `[CODE: realtime/browser-sala.ts (branch)]`.
  - **Notificaciones al candidato (email/SMS)**, edición de puestos post-creación (solo GET/DELETE) y cualquier "IA propia" real de leIA (hoy siempre delega en mock/Gemini/Claude) `[CODE: ausencia de módulos de mailing; routes/jobs.ts sin PATCH]`.
  - **Consumo del WS observador `/ws/interview/:id`:** el canal existe y emite todos los eventos, pero ninguna pantalla lo usa (la UI del reclutador refresca por REST) `[CODE: realtime/interview-ws.ts; grep sin matches de NEXT_PUBLIC_WS_URL en páginas]`.

---

## 4. Restricciones Técnicas y Supuestos (Constraints)

- **Stack y patrones:** Node ≥18 + Fastify 4 + TypeScript en backend; Next.js 13.5 App Router (todo client-side) + Tailwind en frontend; monorepo npm workspaces; patrón factory-por-driver con fallback a mock `[CODE: package.json raíz; services/*/index.ts]`.
- **APIs invocadas:** Recall.ai (`https://{region}.recall.ai/api/v1/bot/…`, `output_audio`, `leave_call`) `[CODE: services/recall/real.ts:35,78,123,146]`; Gemini `generateContent` (texto con `thinkingBudget: 0` y audio TTS) `[CODE: services/leia/gemini.ts:231-249; services/tts/gemini.ts:25-44]`; Anthropic Messages API `[CODE: services/leia/claude.ts:197-211]`; ElevenLabs TTS `[CODE: services/tts/elevenlabs.ts:19-32]`; Edge Read-Aloud vía `msedge-tts` (requiere polyfill de `globalThis.crypto` en Node 18) `[CODE: services/tts/edge.ts:6-9]`.
- **Bases de datos:** tablas `jobs`, `candidates`, `interviews`, `interview_turns`, `transcripts`, `evaluations`, `reports` (UNIQUE interview+kind), `audit_logs` `[CODE: db/schema.sql]`. Solo la creación de jobs escribe auditoría (`action: created_from_link`) `[CODE: routes/jobs.ts:66-74]`.
- **Timeouts/límites observados:** silencio de commit `SILENCE_MS=700`; cola anti-eco `BOT_ECHO_TAIL_MS=500`; auto-finish `4000 ms`; piso `max(6, dimensiones)` turnos y techos `elapsed ≥ 97% de durationMinutes` o `16 turnos` (mock: 90 % / 14); fetch de link `JOB_LINK_TIMEOUT_MS=15000`; retry Gemini solo si `retryDelay ≤ 5 s`; máx 12 muletillas de ≤5 palabras/≤40 chars filtradas por lista negra `[CODE: engine.ts:609-615,684-694; services/leia/gemini.ts:256-286; services/leia/mock.ts:104-109; config.ts:53]`.
- **Manejo de errores:** validación Zod → 400 con issues; 404 `{error: *_not_found}`; fallo de `engine.start()` revierte la entrevista a `agendada` `[CODE: engine.ts (bloques catch de joinMeet)]`; los drivers externos degradan sin propagar (ver Outcome 5).
- **Validaciones de entrada:** email válido y único para candidatos; UUIDs; `meetUrl` debe empezar con `https://meet.google.com/` solo en modo meet (branch); `ttsDriver ∈ {gemini, edge}` a nivel API (aunque el tipo interno admite `mock|elevenlabs`) `[CODE: routes/candidates.ts:7-13; routes/interviews.ts:9-25]`.
- **Permisos y roles:** Bearer `ADMIN_TOKEN` global para `/api/*`, con exenciones `api/health`, `/ws/*`, `/webhooks/*`, `/bot-stage*`, `/api/sala/*` (branch) `[CODE: server.ts:54-66]`. El frontend embebe el token vía `NEXT_PUBLIC_ADMIN_TOKEN` — queda visible en el bundle del browser `[CODE: frontend/lib/api.ts:15]` (hallazgo de seguridad, ver 8.1 INFER-07).
- **Idioma:** español rioplatense con voseo, fijado en prompts y voces default (`es-AR-ElenaNeural`, `INTERVIEW_LANGUAGE=es`) `[CODE: services/leia/prompts.ts:3-7; services/tts/edge.ts:30; config.ts:50]`.
- **NFRs declaradas por la doc local:** costo objetivo ~USD 0.22/entrevista de 20 min y "no salen datos de candidatos a proveedores de IA externos" — esta última **contradicha por el estado actual** (driver activo Gemini recibe transcripciones) `[CONFLICT: código envía transcripts a Gemini/Claude (services/leia/gemini.ts) / README.md §Costos dice que toda la IA queda dentro del sistema]`.

---

## 5. Decisiones de Diseño Previas e Integración

- **`InterviewEngine` + registry** (`services/interview/engine.ts`): orquestador único por entrevista; toda mejora del ciclo conversacional pasa por acá `[CODE]`.
- **`LeiaService`** (`services/leia/index.ts:65-77`): contrato de IA con 6 operaciones; agregar un motor = implementar esta interface y registrarlo en el factory `[CODE]`.
- **`RecallService`** (`services/recall/index.ts`): contrato de captación; ya tiene 3 implementaciones (mock, real, browser) — la sala nativa demostró que el contrato soporta canales no-Meet `[CODE]`.
- **`TTSService` + selección por entrevista** (`services/tts/index.ts`; `Interview.ttsDriver`): cache de instancias por driver `[CODE]`.
- **Buses WS con buffer y handshake** (`botStageBus` en `realtime/bot-stage.ts`; `browserSalaBus` en `realtime/browser-sala.ts` branch): patrón establecido para entregar audio a páginas que pueden no estar conectadas aún (flush por `ready` con fallback de 8 s) `[CODE]`.
- **`analytics.ts`** (`services/interview/analytics.ts`): distribuciones porcentuales determinísticas que suman exactamente 100 (reparto de error de redondeo) — reutilizar para cualquier analítica nueva `[CODE]`.
- **Prompts centralizados** (`services/leia/prompts.ts`): personalidad, reglas duras (scope técnico por stack, no repetir, JSON estricto) y formato de informes compartidos por los drivers Gemini y Claude `[CODE]`.
- **`Database` interface** (`db/index.ts:18-67`): cualquier entidad nueva requiere tocar interface + memory + postgres + schema.sql (los cuatro, para no repetir la deriva de `mode`) `[CODE]`.

---

## 6. Desglose de Tareas de Ingeniería (Task Breakdown)

N/A — modo documentación. El desglose corresponderá al MD de Cambios Propuestos cuando se definan las mejoras.

---

## 7. Criterios de Aceptación y Pruebas (Verification Criteria)

> No existe ningún test automatizado en el repo (vitest declarado sin archivos `*.test.ts`), por lo que **todos** los criterios están inferidos del código de producción y deben validarse manualmente antes de tomarse como garantía. Los `scripts/test-*.ts` del backend son sondas manuales, no criterios.

### AC01 — Demo end-to-end sin claves
- **Dado:** `.env` copiado de `.env.example` sin tocar (todos los drivers mock, BD memoria), backend en :4000 y frontend en :3000.
- **Cuando:** el reclutador crea el puesto desde `https://ejemplo.com/frontend-react-senior?title=Frontend%20React`, crea la candidata `Ana Pérez <ana@test.com>`, agenda con `meetUrl=https://meet.google.com/abc-defg-hij`, inicia, y envía 7 respuestas de >15 palabras vía `POST /api/interviews/:id/simulate-answer`.
- **Entonces:** cada respuesta produce una `Evaluation` con score 0-10 y 6 dimensiones; tras `POST /:id/finalize` la entrevista queda `completada` con Informe 1 y 2 disponibles en `GET /api/reports/:id/1|2`.
- **Origen:** [INFER: encadenado de routes/interviews.ts, engine.ts, mock.ts — no hay test que lo cubra]

### AC02 — Health declara los drivers
- **Dado:** backend levantado con `LEIA_DRIVER=gemini`, `RECALL_DRIVER=mock`, `TTS_DRIVER=edge`, `DATABASE_DRIVER=memory` y `GEMINI_API_KEY` válida.
- **Cuando:** `GET /api/health` sin header Authorization.
- **Entonces:** 200 con `drivers: {leia:'gemini', recall:'mock', tts:'edge', database:'memory'}` y `demoMode:false`.
- **Origen:** [INFER: server.ts:43-52 + config.ts:67-83]

### AC03 — Auth por token estático
- **Dado:** `ADMIN_TOKEN=admin-demo-token-cambiar`.
- **Cuando:** `GET /api/interviews` con `Authorization: Bearer otro-token`.
- **Entonces:** 401 `{error:'unauthorized'}`; el mismo request a `/api/health`, `/webhooks/recall/ping` o `/bot-stage/x` responde 200 sin token.
- **Origen:** [INFER: server.ts:54-66]

### AC04 — Fallback silencioso por API key ausente
- **Dado:** `LEIA_DRIVER=claude` y `ANTHROPIC_API_KEY` vacío.
- **Cuando:** arranca el backend y se corre una entrevista.
- **Entonces:** leIA opera con el mock heurístico (log warn "Usando mock como fallback") y la entrevista se completa igual.
- **Origen:** [INFER: services/leia/index.ts:92-99]

### AC05 — Commit de respuesta por silencio de captions
- **Dado:** entrevista `en_curso` en modo meet; leIA terminó de hablar (pasaron `durationMs + 500 ms` desde el primer chunk de audio).
- **Cuando:** llegan captions finales del candidato "Trabajé con React y Redux en un e-commerce" y luego no llega ningún caption nuevo por 700 ms.
- **Entonces:** el turno se cierra con ese texto como `answerTranscript`, se persiste la evaluación y leIA pasa a la siguiente pregunta; un evento VAD `speech_on` de ruido ambiente NO reinicia el timer.
- **Origen:** [INFER: engine.ts handleRecallEvent() caption/speaking + armSilenceTimer() + comentario explícito sobre VAD]

### AC06 — Anti-eco half-duplex solo en modo meet
- **Dado:** leIA está reproduciendo audio (dentro de la ventana `botSpeakingUntilMs`).
- **Cuando:** llega un caption atribuido al candidato durante esa ventana.
- **Entonces:** en modo `meet` el caption se persiste en transcripts pero NO alimenta la respuesta del turno; en modo `browser` SÍ la alimenta (no hay eco físico y bloquearlo creaba una ventana muerta).
- **Origen:** [INFER: engine.ts:397-401 (branch) — comentario del código explica la razón]

### AC07 — Aclaración no avanza el turno
- **Dado:** turno 3 en curso; el candidato responde "sí" (2 palabras).
- **Cuando:** leIA evalúa (mock o LLM con `isClarification=true`).
- **Entonces:** la siguiente emisión es una aclaración ("¿Podrías ampliarlo…?"), `turnIndex` NO se incrementa y la pregunta original sigue vigente.
- **Origen:** [INFER: engine.ts:490-494; mock.ts:112-118]

### AC08 — Guard de preguntas repetidas
- **Dado:** historial con la pregunta "¿Cómo encarás un problema de performance en React?".
- **Cuando:** leIA genera una `nextQuestion` cuya similitud Jaccard de tokens (sin stopwords) con alguna previa es ≥ 0.6.
- **Entonces:** se re-invoca `evaluate` con nota interna pidiendo otra pregunta; si la segunda también es similar, se acepta igual (no hay loop).
- **Origen:** [INFER: engine.ts:429-449,640-675]

### AC09 — Cierre automático por límites
- **Dado:** puesto con `durationMinutes=20` y 6 dimensiones.
- **Cuando:** `turnIndex < 6` y el LLM devuelve `shouldFinish=true`, o bien `elapsedSec ≥ 1164` (97 %) o el historial llega a 16 turnos.
- **Entonces:** en el primer caso el cierre se anula (piso); en el segundo se fuerza (techo), leIA dice un cierre generado, y `stop('auto')` marca `completada` y genera informes.
- **Origen:** [INFER: services/leia/gemini.ts:138-149; claude.ts:116-121; engine.ts:465-489]

### AC10 — Auto-finalización al cortar el Meet
- **Dado:** entrevista `en_curso` en modo meet con bot real.
- **Cuando:** llega `participant_events.leave` de un participante que no es el bot (o lifecycle `left`).
- **Entonces:** a los 4 s (si no hubo reconexión que ya la haya finalizado) la entrevista pasa a `completada` con informes generados, sin acción del reclutador; `stop` es idempotente (segunda llamada devuelve los informes ya creados).
- **Origen:** [INFER: engine.ts:287-321,164-192]

### AC11 — Informe 2 con analítica determinística
- **Dado:** 8 turnos evaluados con scores [9,8,7,6,5,4,3,vacío].
- **Cuando:** se genera el Informe 2 (cualquier driver).
- **Entonces:** `qualityDistribution` sale de los scores reales (excellent ≥8, good 6-7.99, fair 4-5.99, poor <4) en porcentajes enteros que suman exactamente 100, `turnsAnalyzed=8`, y si el LLM devolvió sentimiento vacío se usa el fallback objetivo (vacío/incomprensible → notApplicable; <4.5 o vaga → negative; <7 → neutral; resto positive).
- **Origen:** [INFER: engine.ts:556-571; analytics.ts:35-73]

### AC12 — Selección de voz por entrevista, bloqueada al iniciar
- **Dado:** entrevista `agendada` con `ttsDriver='gemini'`.
- **Cuando:** `PATCH /api/interviews/:id/tts {ttsDriver:'edge'}` antes de iniciar; y el mismo PATCH después de `start`.
- **Entonces:** el primero responde `{ok:true}` y la entrevista habla con Edge; el segundo responde 409 `{error:'interview_already_started'}`.
- **Origen:** [INFER: routes/interviews.ts:93-109]

### AC13 — Sala nativa arranca sola con el candidato (branch)
- **Dado:** entrevista creada con `mode='browser'` (BD memoria), candidato con el link `/sala/:id`.
- **Cuando:** el candidato abre la sala, acepta permisos y el frontend manda `{type:'ready'}` por `/ws/sala/:id`.
- **Entonces:** la entrevista pasa a `en_curso` sin que el reclutador toque nada, leIA saluda por audio WS (sentence-streaming), y al colgar (`hangup` o cierre del WS) la entrevista se finaliza y `report_ready` llega por el mismo WS.
- **Origen:** [INFER: realtime/browser-sala.ts; services/recall/browser.ts; app/sala/[id]/page.tsx @ fa9a386]

### AC14 — Sala nativa inaccesible para entrevistas meet
- **Dado:** entrevista creada con `mode='meet'`.
- **Cuando:** `GET /api/sala/:id/info`.
- **Entonces:** 404 `{error:'sala_no_encontrada'}` (la cara pública solo expone entrevistas browser).
- **Origen:** [INFER: realtime/browser-sala.ts GET info — exige `interview.mode === 'browser'`]

### Notas sobre la reconstrucción de criterios
- **Cobertura de tests: nula.** Los 14 criterios son `[INFER]` sobre código de producción; se listan igualmente en 8.1 como una sola entrada agregada (INFER-00) para no duplicar la tabla.
- Áreas de mayor riesgo de inferencia: timing del half-duplex y del sentence-streaming (dependen del comportamiento real de Recall/edge-tts), y el contrato exacto de los webhooks de Recall (el parser acepta múltiples formatos "que Recall usa hoy" `[CODE: services/recall/real.ts:160-175]`).

---

## 8. Gaps, Inferencias Opacas y Conflictos

### 8.1 Inferencias Opacas

| ID | Afirmación | Sección donde aparece | Razón de la inferencia opaca |
|---|---|---|---|
| INFER-00 | Los 14 criterios de aceptación describen el comportamiento real | §7 | Sin tests ni ejecución; solo lectura de código |
| INFER-01 | `CandidateVideo`, `BotTile`, `BotAvatar` y `useFaceAnalysis` son restos de una iteración anterior o preparación futura: ningún page los importa en main NI en los branches | §3 | El analista respondió "no sé" sobre su origen; git no muestra un consumidor que se haya borrado en los commits presentes |
| INFER-02 | El pipeline `BehavioralAnalysis` (tipos, prompts, render del informe, body de `/finalize`) quedó preparado para una captura por cámara aún no conectada | §3 | Analista: "no sé"; existe el productor natural (`useFaceAnalysis`) pero nada lo enchufa |
| INFER-03 | `generateMeetUrl()` (`services/interview/meet.ts`) es código muerto de la etapa en que la URL de Meet se simulaba | §3 | Sin referencias entrantes; coincide con el README viejo pero nadie lo confirmó |
| INFER-04 | Redis (docker-compose) estaba previsto para colas/estado y nunca se usó | Mapa §2.3 | Cero referencias en código; solo compose y README |
| INFER-05 | `@fastify/jwt`, `@fastify/static`, `lamejs`, `@tanstack/react-query` son dependencias vestigiales | Mapa §2.2 | Declaradas sin uso; `JWT_SECRET` validado en config pero jamás leído |
| INFER-06 | El WS observador `/ws/interview/:id` quedó como infraestructura para una vista en vivo del reclutador que no se construyó (o se abandonó con `entrevista-en-vivo/`) | §3 | Ningún cliente lo consume; el README describe la vista que lo usaría |
| INFER-07 | **Seguridad:** `NEXT_PUBLIC_ADMIN_TOKEN` expone el token admin en el bundle del browser; cualquiera que cargue el frontend puede operar toda la API | §4 | Hallazgo de código (`frontend/lib/api.ts:15`), se reporta como gap por convención del rol; aceptabilidad en PoC no confirmada |
| INFER-08 | **Seguridad (branch):** `POST /api/sala/:id/finalize` y `/recording` son públicos: conocer el UUID permite finalizar una entrevista ajena o subir blobs arbitrarios | §4 | Diseño deliberado para el candidato sin auth, pero el alcance de abuso no está mitigado ni documentado |
| INFER-09 | `classifySpeaker` clasifica como "candidate" a cualquier participante cuyo nombre no matchee al bot; en reuniones con reclutador presente, sus dichos se evalúan como del candidato | §3 | Sin test ni doc que confirme si es limitación aceptada |
| INFER-10 | El atributo `config: { skipAuth: true }` en `/api/sala/:id/recording` no tiene efecto (la exención real es el prefijo de URL en el preHandler) | §4 (branch) | Solo lectura de código; parece residuo de otra estrategia de auth |
| INFER-11 | En modo meet + `ttsDriver=gemini`, el audio WAV nunca usa `output_audio` (que exige MP3) y siempre cae al WS del bot-stage; con `edge` (MP3) usa el camino rápido | §2 Outcome 3 | Deducción de `isMp3` en real.ts (develop) + mime `audio/wav` de GeminiTTS; sin prueba ejecutada |

### 8.2 Conflictos Código ↔ Documentación

La "documentación" es el README.md/SETUP.md del repo (línea de base declarada por el analista). El código gana como estado actual.

| ID | Qué dice el código | Qué dice la documentación | Sección afectada | Severidad |
|---|---|---|---|---|
| CONFLICT-01 | Transcripción por `recallai_streaming` (`services/recall/real.ts:56-58`): STT de Recall, no captions de Meet | README §stack y SETUP §4: "captions nativos de Meet", `transcription_options.provider = meeting_captions`, "STT USD 0.00" | §1, §4 (costos) | Alta |
| CONFLICT-02 | TTS drivers `mock\|elevenlabs\|gemini\|edge` (`config.ts:41`), default operativo por entrevista `gemini\|edge` (`routes/interviews.ts:176-178`), deploy con `TTS_DRIVER=gemini` (`render.yaml`) | README §drivers: "`TTS_DRIVER` = `mock` (default) o `elevenlabs`"; SETUP §5 solo documenta ElevenLabs | §2 Outcome 2 | Alta |
| CONFLICT-03 | El envío de transcripciones a Gemini/Claude es el modo real de operar (`LEIA_DRIVER=gemini` activo según SETUP §3a) | README §Costos: "toda la IA queda dentro del sistema. No salen datos de candidatos a proveedores de IA externos" | §4 NFRs | Alta |
| CONFLICT-04 | No existe `frontend/app/entrevista-en-vivo/`; el detalle de entrevista abre el Meet en otra pestaña y refresca por REST; la sala en vivo real es `/sala/[id]` (browser, branch) | README §estructura: "`entrevista-en-vivo/[id]/` sala en vivo con captions" | §1, §3 | Media |
| CONFLICT-05 | `POST /api/interviews` exige `meetUrl` real (modo meet) pegada por el reclutador; `generateMeetUrl()` está muerto | README §demo: "Se asigna una URL de Meet `meet.google.com/...` simulada" | §1 paso 2 | Media |
| CONFLICT-06 | Superficies además exentas de auth: `/bot-stage*` y `/api/sala/*`; endpoints extra: `PATCH /:id/tts`, DELETEs, `/api/reports/by-interview/:id`, `/bot-stage-diag`, `/webhooks/recall/ping` | README §endpoints: lista sin esos endpoints y dice que solo `/api/health`, `/ws/*` y `/webhooks/*` van sin token | §4 permisos | Media |
| CONFLICT-07 | `main` usaba solo bot-stage WS con comentario "output_audio PROHIBIDO para respuestas dinámicas" (`bot-stage.ts main`); develop reintroduce `output_audio` como camino primario | El propio código main vs develop (deriva interna documentada en comentarios contradictorios) | §2 Outcome 3 | Media |
| CONFLICT-08 | Informes accesibles en una sola página `/entrevistas/[id]/informe` combinando ambos payloads | README §demo paso 5: "aparecen Informe 1 e Informe 2" como artefactos separados | §1 paso 7 | Baja |
| CONFLICT-09 | `package.json` raíz: "basado en Google Cloud Vertex AI" | Ningún código usa Vertex AI (README v2 tampoco lo menciona) | Metadatos del repo | Baja |

**Acción recomendada:** actualizar README/SETUP tras decidir el merge de branches; hasta entonces, el Arquitecto debe asumir el comportamiento del código y tratar los puntos CONFLICT-01/02/03 como decisiones de producto a re-validar (costo real, privacidad de datos de candidatos, canal de transcripción).

### 8.3 Hallazgos de base de código

1. **Dos branches sin mergear, historia lineal:** `origin/develop` (`eb6e489`: sentence-streaming TTS, fallback GeminiTTS→Edge, avatar en video, output_audio-first, `fromForm.ts`) y `origin/feature/sala-nativa` (`fa9a386`: modo browser completo). `main` local = `origin/main`. La spec asume ambos integrados `[USR]`, pero **hoy no lo están**: cualquier mejora que parta de `main` sin mergearlos queda especificada contra otra base.
2. **`fromForm.ts` rompe la compilación de develop/sala-nativa:** importa `JobModality`, `JobHiringStatus` (no existen en `types.ts` de ningún branch) y llama `leia.structureJob()` (no existe en `LeiaService`). Nadie lo importa. `tsc` sobre `src/` debería fallar → **prerrequisito de merge: completar esa feature o borrar el archivo** `[CODE: git show origin/develop:backend/src/services/jobs/fromForm.ts; grep sin matches de JobModality/structureJob]`.
3. **`Interview.mode` no persiste en Postgres:** `schema.sql` y `postgres.ts` no cambiaron en los branches; el INSERT/UPDATE de interviews no incluye `mode` → con `DATABASE_DRIVER=postgres` toda entrevista pierde el modo y `GET /api/sala/:id/info` da 404. La sala nativa es funcional **solo en memoria** `[CODE: db/postgres.ts:164,191; git diff main..fa9a386 -- backend/src/db/ vacío]`.
4. **Assets binarios en el repo (develop):** mp4/gif del avatar (~5 MB en sala-nativa) versionados en `backend/assets/`.
5. **Sin migraciones formales:** el esquema evoluciona con `IF NOT EXISTS`/`DO $$` dentro de `schema.sql`; agregar `mode` requerirá el mismo patrón o introducir una herramienta de migraciones.

---

## Actualizaciones Sugeridas al Mapa del Sistema

Ninguna — `docs/specs/ARQUITECTURA_DEL_SISTEMA.md` v1.0 se generó en esta misma sesión y ya refleja estos hallazgos.

---

## CHANGELOG

- v1.0 (2026-07-06): Versión inicial. Reconstrucción completa del flujo end-to-end de la PoC (backend + frontend + branches develop y feature/sala-nativa). Tests ejecutados: no (no existen). NotebookLM: no (README/SETUP locales usados como doc). Ticket leído: no. Conteo REAL de marcas: [CODE]: 44, [TEST]: 0, [TEST-EXEC]: 0, [DOC]: 3, [CODE+DOC]: 0, [TICKET]: 0, [USR]: 5, [INFER]: 26, [CONFLICT]: 10.
