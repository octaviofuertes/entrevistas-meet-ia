# Plan de Ejecución — Arnés leIA · Etapa 0 (Saneo) + Spike Live API

## Metadatos

- **ID Ticket:** N/A (alcance `ENTREVISTADOR_IA_LEIA`, Etapa 0 del contrato `ENTREVISTADOR_IA_LEIA_CAMBIOS_PROPUESTOS_v1.0.md`)
- **Versión:** v1.0
- **Fecha:** 2026-07-06
- **Origen:** Análisis del Arquitecto SDD (ver `ENTREVISTADOR_IA_LEIA_ARQUITECTO_v1.0.md` para contexto, justificaciones y diagramas).
- **Destinatario:** Agente Ejecutor (Codificador). Documento agnóstico de herramienta: solo asume leer/editar/crear archivos y ejecutar comandos shell.
- **Base de código requerida:** branch `main` @ `0686437` con working tree limpio. **T01 integra los branches remotos `origin/develop` y `origin/feature/sala-nativa` (fast-forward); nada de este plan se ejecuta antes de T01.** ATENCIÓN: entre T01 y el fin de T02 el build del backend NO compila (archivo `fromForm.ts` con tipos inexistentes) — es esperado y T02 lo resuelve.
- **Stack y comandos del proyecto:** monorepo npm workspaces; Node ≥ 18.
  - Build backend: `npm run build --workspace=backend` (tsc)
  - Tests backend: `npx vitest run` ejecutado dentro de `backend/` (vitest está en devDependencies; hoy no existe ningún test — este plan crea los primeros)
  - Dev: `npm run dev` (backend :4000 + frontend :3000)
  - Postgres local: `docker compose up -d postgres` (carga `backend/src/db/schema.sql` al primer arranque del volumen)
  - Seed: `npm run seed --workspace=backend`
  - Auth de la API: header `Authorization: Bearer admin-demo-token-cambiar` (valor default de `ADMIN_TOKEN` en `.env`)
  - El frontend NO tiene test runner: sus verificaciones son manuales (declaradas caso por caso).

---

## Misión

Dejar `main` estable y compilando con los dos branches integrados, la feature "puesto desde formulario" completa, el modo de entrevista persistido en Postgres, la primera suite de tests que fija el comportamiento del motor de entrevistas, la documentación alineada con el código, y un veredicto go/no-go sobre Gemini Live API — la compuerta que habilita la Etapa 1.

---

## Guardarraíles (No Negociables)

### Lo que NO se modifica

- `docs/**` salvo los entregables que este plan indica (resultados del spike). Los contratos SDD existentes no se tocan.
- El comportamiento actual del `InterviewEngine` (`backend/src/services/interview/engine.ts`): en esta etapa **solo se lee** para escribir tests de caracterización. Si un test revela un comportamiento que parece bug, se documenta en el reporte final — NO se "arregla".
- Los componentes huérfanos (`frontend/components/CandidateVideo.tsx`, `BotTile.tsx`, `BotAvatar.tsx`, `backend/src/services/interview/meet.ts`): no se borran ni se usan.
- No se cambian versiones de dependencias existentes. Dependencias nuevas permitidas en este plan: ninguna en backend/frontend de producción (el spike puede usar `@google/genai` como devDependency de scripts si lo necesita).
- Los endpoints y su esquema de auth actual (preHandler de `backend/src/server.ts`): sin cambios en esta etapa.

### Convenciones de código a respetar

- Validación de inputs en rutas con Zod → error 400 `{ error: 'invalid_input', issues }` (patrón de `backend/src/routes/jobs.ts`).
- Errores de negocio: 404 `{ error: '<entidad>_not_found' }`, 409 para conflictos (patrón de `routes/candidates.ts` y `routes/interviews.ts`).
- Logging con el logger pino existente (`backend/src/logger.ts`), objetos contextuales, mensajes en español.
- Naming de archivos kebab-case; dominio, prompts y UI en español rioplatense.
- Drivers de IA: patrón factory + fallback a mock ante error o API key vacía (ver `backend/src/services/leia/index.ts` y `gemini.ts`); parsers defensivos (`extractJSON`, `clamp` — copiar el patrón de `services/leia/gemini.ts`).
- Migraciones de esquema: idempotentes dentro de `backend/src/db/schema.sql` con `ADD COLUMN IF NOT EXISTS` y bloques `DO $$ ... $$` para constraints (patrón existente de `tts_driver`, líneas 68-82).
- Tipos espejados: todo tipo agregado a `backend/src/types.ts` que el frontend consuma se replica a mano en `frontend/lib/types.ts` (convención actual del repo).

### Constraints técnicas

- Node ≥ 18; TypeScript estricto del `tsconfig` existente.
- Ninguna llamada nueva a servicios pagos fuera del spike (T06).

---

## Archivos a Crear

1. `backend/src/routes/jobs.ts` — no es nuevo, se modifica (ver abajo); listado acá solo para claridad: la ruta nueva vive en este archivo.
2. `backend/src/services/interview/engine.test.ts` — tests de caracterización del engine.
3. `backend/src/services/interview/analytics.test.ts` — tests de las distribuciones determinísticas.
4. `backend/src/services/jobs/fromForm.test.ts` — tests del builder from-form (con leIA mock).
5. `backend/vitest.config.ts` — configuración mínima de vitest (entorno node, include `src/**/*.test.ts`).
6. `backend/scripts/spike-live-api.ts` — sonda manual del spike (T06).
7. `docs/specs/SPIKE_LIVE_API_RESULTADOS_v1.0.md` — entregable del spike con veredicto go/no-go.
8. `frontend/app/puestos/nuevo/` — se modifica la página existente (pestañas); no hay archivo nuevo obligatorio (si el implementador prefiere extraer el formulario a un componente, ubicarlo en `frontend/components/JobFormNuevo.tsx`).

## Archivos a Modificar

1. `backend/src/types.ts` — tipos `JobModality`, `JobHiringStatus`; campos nuevos en `Job`; flag en `JobPreferences`.
2. `frontend/lib/types.ts` — espejo de lo anterior.
3. `backend/src/services/leia/index.ts` — `structureJob` en la interface `LeiaService` + tipos de entrada/salida.
4. `backend/src/services/leia/mock.ts` — implementación heurística de `structureJob`.
5. `backend/src/services/leia/gemini.ts` — implementación LLM de `structureJob` con fallback a mock.
6. `backend/src/services/leia/claude.ts` — ídem.
7. `backend/src/services/jobs/fromLink.ts` — exportar `detectStack`, `detectSeniority`, `defaultYears` (hoy privadas) para reutilizar en el mock; setear los campos nuevos de `Job` en el builder (null/defaults) y el flag de análisis en `true`.
8. `backend/src/services/jobs/fromForm.ts` — ajustar imports a los tipos reales creados; setear flag de análisis `true`; sin otros cambios de lógica.
9. `backend/src/db/schema.sql` — columnas nuevas de `jobs` y `interviews.mode` (idempotentes).
10. `backend/src/db/postgres.ts` — mapping de columnas nuevas en `createJob`/`updateJob`/`rowToJob` y `mode` en `createInterview`/`updateInterview`/`rowToInterview`.
11. `backend/src/routes/jobs.ts` — ruta `POST /api/jobs/from-form`.
12. `backend/src/db/seed.ts` — el job demo incluye los campos nuevos y el flag.
13. `frontend/lib/api.ts` — `apiCreateJobFromForm`.
14. `frontend/app/puestos/nuevo/page.tsx` — pestañas "Desde link" / "Desde formulario".
15. `README.md` y `SETUP.md` — alineación con el código (T05).
16. `backend/package.json` — script `"test": "vitest run"` ya existe; agregar `@google/genai` SOLO como devDependency si el spike lo requiere.

---

## Tareas (Orden Topológico)

### T01 — Integrar los branches en vuelo

**Qué hacer:**
1. Verificar working tree limpio: `git status --short` (solo `docs/` sin trackear es aceptable).
2. `git fetch --all`
3. `git merge --ff-only origin/feature/sala-nativa` (trae también `origin/develop`: la historia es lineal `main ⊂ develop ⊂ sala-nativa`).
4. Verificar: `git log --oneline -5` debe mostrar `fa9a386` como HEAD.

**Archivos involucrados:** ninguno editado a mano.

**Criterio de validación:**
```bash
git rev-parse HEAD   # → fa9a386...
git merge-base --is-ancestor origin/develop HEAD && echo OK   # → OK
npm run build --workspace=backend
# DEBE FALLAR con errores de tipos en services/jobs/fromForm.ts
# (JobModality/JobHiringStatus/structureJob inexistentes). Ese fallo es el
# estado esperado que T02 resuelve. Si falla por OTRA causa, detenerse y reportar.
```

**Depende de:** Ninguna.

---

### T02 — Completar la feature "puesto desde formulario"

**Qué hacer (sub-pasos en orden):**

**2.a Tipos (backend/src/types.ts):**
```ts
export type JobModality = 'presencial' | 'hibrido' | 'remoto';
export type JobHiringStatus = 'abierto' | 'pausado' | 'cerrado';
```
Extender `Job` con: `publishedAt?: ISODate | null; location?: string | null; salary?: string | null; vacancies?: number | null; modality?: JobModality | null; hiringStatus?: JobHiringStatus | null;`
Extender `JobPreferences` con: `behavioralAnalysisEnabled?: boolean;` (semántica: `undefined` ⇒ activado; se usa recién en Etapa 2, pero el dato nace acá).
Replicar todo en `frontend/lib/types.ts`.

**2.b Contrato leIA (backend/src/services/leia/index.ts):** agregar a la interface:
```ts
export interface StructureJobInput { title: string; description: string; knowledge: string; language: string; }
export interface StructureJobOutput { stack: string[]; seniority: Job['requirements']['seniority']; yearsOfExperience: number; responsibilities: string[]; niceToHave: string[]; }
// en LeiaService:
structureJob(input: StructureJobInput): Promise<StructureJobOutput>;
```

**2.c Implementaciones:**
- `mock.ts`: heurística determinista reutilizando `detectStack`, `detectSeniority`, `defaultYears` (exportarlas desde `services/jobs/fromLink.ts`) aplicadas a `title + description + knowledge`; `responsibilities`: hasta 5 líneas/viñetas de la descripción o defaults actuales de `fromLink`; `niceToHave`: `[]`.
- `gemini.ts` y `claude.ts`: prompt de sistema corto ("Sos leIA. Estructurá este puesto. Devolvé JSON estricto {stack:[], seniority:'junior|semi|senior|lead', yearsOfExperience:n, responsibilities:[], niceToHave:[]}"), user con título/descripción/conocimientos, `json: true` donde aplique, parser defensivo con clamps y **fallback al mock ante cualquier error** (patrón idéntico a `generateFillers`).

**2.d Esquema (backend/src/db/schema.sql):** después del bloque de `jobs`, agregar idempotente:
```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS published_at  TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS location      TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary        TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS vacancies     INTEGER;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS modality      TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hiring_status TEXT NOT NULL DEFAULT 'abierto';
```
Constraints `CHECK` para `modality` y `hiring_status` con bloques `DO $$ ... $$` (copiar el patrón de `chk_interviews_tts_driver`).

**2.e Postgres driver (backend/src/db/postgres.ts):** incluir las columnas nuevas en `createJob`, `updateJob` y el row-mapper de jobs (camelCase ↔ snake_case como el resto).

**2.f Builders:** en `fromLink.ts` setear los campos nuevos (`publishedAt: now`, resto `null`, `hiringStatus: 'abierto'`) y `behavioralAnalysisEnabled: true` en preferences; en `fromForm.ts` corregir imports a los tipos reales y setear el flag igual.

**2.g Ruta (backend/src/routes/jobs.ts):** `POST /api/jobs/from-form` con Zod:
```ts
{ title: string().min(3), company: string().optional(), description: string().min(10),
  knowledge: string().min(3), location: string().optional(), salary: string().optional(),
  modality: enum(['presencial','hibrido','remoto']).optional(), vacancies: number().int().min(1).max(99).optional(),
  hiringStatus: enum(['abierto','pausado','cerrado']).optional(), publishedAt: string().datetime().optional(),
  language: string().optional(), preferences: <mismo sub-schema opcional que from-link> }
```
Llama `buildJobFromForm`, persiste con `db.createJob`, registra auditoría `action: 'created_from_form'` (patrón del from-link), responde 201 con el Job.

**2.h Frontend:** `apiCreateJobFromForm` en `frontend/lib/api.ts`; en `frontend/app/puestos/nuevo/page.tsx` dos pestañas — "Desde link" (comportamiento actual intacto) y "Desde formulario" (campos del schema; al crear, navegar al detalle del puesto). UI mínima con las clases existentes (`card`, `input`, `btn-primary`).

**2.i Seed:** completar el job demo con los campos nuevos.

**Archivos involucrados:** los numerados 1-8, 12-14 de "Archivos a Modificar".

**Criterio de validación:**
```bash
npm run build --workspace=backend    # compila sin errores (cubre AC-NEW-15)
# Con el backend corriendo (npm run dev) y BD memoria:
curl -s -X POST http://localhost:4000/api/jobs/from-form \
  -H 'Authorization: Bearer admin-demo-token-cambiar' -H 'Content-Type: application/json' \
  -d '{"title":"SSR Fullstack","company":"Acme","description":"Buscamos dev con React, Node y Postgres para APIs","knowledge":"APIs REST, testing","location":"Mendoza","modality":"remoto","vacancies":2}'
# → 201; el JSON incluye requirements.stack conteniendo React, Node.js y PostgreSQL,
#   requirements.seniority = "semi", location "Mendoza", hiringStatus "abierto" (cubre AC-NEW-13 con LEIA_DRIVER=mock)
```

**Depende de:** T01.

---

### T03 — Persistir `Interview.mode` en Postgres

**Qué hacer:**
1. En `schema.sql`, tras la tabla `interviews`:
```sql
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'meet';
```
más constraint `CHECK (mode IN ('meet','browser'))` con bloque `DO $$` (patrón `chk_interviews_tts_driver`).
2. En `postgres.ts`: agregar `mode` al INSERT de `createInterview`, al UPDATE de `updateInterview` y al row-mapper (`mode: r.mode ?? 'meet'`).

**Archivos involucrados:** `backend/src/db/schema.sql`, `backend/src/db/postgres.ts`.

**Criterio de validación (cubre AC-NEW-14):**
```bash
docker compose up -d postgres
# .env: DATABASE_DRIVER=postgres
npm run seed --workspace=backend
# Backend corriendo: crear candidato + entrevista browser
curl -s -X POST http://localhost:4000/api/interviews \
  -H 'Authorization: Bearer admin-demo-token-cambiar' -H 'Content-Type: application/json' \
  -d '{"jobId":"<id del seed>","candidateId":"<id creado>","mode":"browser"}'
# Reiniciar el proceso backend, luego:
curl -s http://localhost:4000/api/sala/<interviewId>/info
# → 200 con jobTitle/candidateName (hoy, sin este fix, devuelve 404 sala_no_encontrada)
```

**Depende de:** T01 (puede hacerse en paralelo con T02; el criterio de validación requiere T02 terminada para que el backend compile).

---

### T04 — Tests de caracterización del motor (primera suite del repo)

**Qué hacer:** crear `backend/vitest.config.ts` (entorno `node`, include `src/**/*.test.ts`) y escribir tests que **fijen el comportamiento actual** (no el deseado). Usar dobles in-process: instanciar `InterviewEngine` con un `Database` fake (Maps), y monkeypatch de `getRecall`/`getLeia`/`getTTS` no es necesario si se inyecta vía el registry — en su defecto, setear `RECALL_DRIVER=mock`, `LEIA_DRIVER=mock`, `TTS_DRIVER=mock` por env del test y usar los mocks reales del proyecto. Timers: usar los fake timers de vitest para no esperar 700 ms reales.

Casos mínimos (con los valores duros actuales):
1. **Commit por silencio:** captions finales del candidato + 700 ms sin nuevos → el turno se cierra con el texto concatenado y se crea la evaluación (`engine.test.ts`).
2. **Eco ignorado en modo meet:** caption de candidato mientras `botSpeakingUntilMs` está vigente → NO alimenta el buffer (pero se persiste en transcripts).
3. **Modo browser no bloquea:** mismo caso con `interview.mode='browser'` → SÍ alimenta el buffer.
4. **Aclaración no avanza turno:** respuesta de 2 palabras con mock → `isClarification=true`, `turnIndex` no incrementa.
5. **Guard anti-repetición:** `findSimilarQuestion` con dos preguntas de Jaccard ≥ 0.6 → detecta; < 0.6 → null (exportar el helper o testearlo vía el flujo).
6. **Auto-finish idempotente:** `participant_left` (speaker ≠ bot) → tras el delay la entrevista queda `completada` y una segunda llamada a `stop()` devuelve los mismos informes sin duplicar.
7. **`splitSentences`:** texto corto (≤60 chars) → 1 chunk; texto multi-oración → N chunks con signos preservados.
8. **`isNeutralFiller`:** rechaza evaluativas/largas ("¡Excelente!", >5 palabras), acepta neutras ("Ajá.", "Dejame pensar.").
9. **`analytics.test.ts`:** `computeQualityDistribution` con scores [9,8,7,6,5,4,3] suma exactamente 100 y bucketiza según los umbrales; `computeSentimentFallback` clasifica vacía→notApplicable, <4.5→negative, <7→neutral, ≥7→positive.
10. **`fromForm.test.ts`:** con leIA mock, `buildJobFromForm` produce Job válido con stack detectado del texto y `hiringStatus='abierto'`.

Si algún test revela comportamiento distinto al descrito: el test documenta el comportamiento REAL y la discrepancia se anota en el reporte final (guardarraíl: no se corrige el engine en esta etapa).

**Archivos involucrados:** `backend/vitest.config.ts`, `backend/src/services/interview/engine.test.ts`, `backend/src/services/interview/analytics.test.ts`, `backend/src/services/jobs/fromForm.test.ts`. Cambios mínimos de exportación permitidos (`export` de helpers puros como `splitSentences`, `isNeutralFiller`, `findSimilarQuestion`) — sin cambiar su lógica.

**Criterio de validación:**
```bash
cd backend && npx vitest run
# → todas las suites pasan (≥ 10 tests). Este comando queda como la suite oficial del repo.
```

**Depende de:** T02 (el backend debe compilar).

---

### T05 — Verificación end-to-end sobre Postgres + README/SETUP alineados

**Qué hacer:**
1. Flujo completo en Postgres (`DATABASE_DRIVER=postgres`, resto mock): puesto desde link Y desde formulario → candidato → entrevista `meet` (con `simulate-answer` ×7) → finalize → informes 1 y 2; entrevista `browser` → sala arranca con `ready` (usar `backend/scripts/test-bot-stage-ws.ts` como referencia de sondas existentes o el navegador) → hangup → informes.
2. Actualizar `README.md` y `SETUP.md` resolviendo los 9 conflictos del snapshot §8.2 (mínimo: drivers TTS reales `mock|elevenlabs|gemini|edge` y selector por entrevista; transcripción `recallai_streaming`; sala nativa `/sala/:id` y modo `browser`; `meetUrl` manual en modo meet; endpoints y exenciones de auth reales incluyendo `/api/sala/*` y `/bot-stage*`; el informe único; nueva ruta `from-form`; quitar "Vertex AI" del `package.json` raíz description).
3. Documentar en README la matriz de capacidades por canal (sala nativa vs Meet) según decisión D8 del análisis (gemini=WAV→WS fallback; edge=MP3→output_audio).

**Archivos involucrados:** `README.md`, `SETUP.md`, `package.json` (solo description), sin cambios de código salvo bugs de integración detectados (reportarlos antes de tocar).

**Criterio de validación:** los pasos del flujo (1) completados sin errores en logs, con la checklist manual documentada abajo en "Verificación Final"; `git grep -n "meeting_captions\|entrevista-en-vivo\|Vertex AI" README.md SETUP.md package.json` → sin resultados.

**Depende de:** T02, T03, T04.

---

### T06 — Spike Gemini Live API (compuerta go/no-go, timebox 1 día)

**Qué hacer:** crear `backend/scripts/spike-live-api.ts` (sonda manual, mismo estilo que `scripts/test-tts.ts`) que, con `GEMINI_API_KEY` de tier pago, abra una sesión del Live API (modelo de la familia 3.x Flash Live vigente) y verifique **cada criterio con evidencia**:

1. **Conexión y conversación:** sesión con un system prompt corto de leIA; enviar audio (o texto→audio) y recibir audio de respuesta.
2. **Transcripciones:** activar transcripción de entrada y salida; confirmar que llegan como eventos separados y utilizables (son el enganche del arnés — decisión D1).
3. **Barge-in:** interrumpir con audio mientras el modelo habla; medir el tiempo hasta que se detiene la salida.
4. **Sesión larga:** configurar session resumption + compresión de ventana de contexto; sostener ≥ 18 minutos de sesión (puede ser con silencios) atravesando al menos una reconexión.
5. **Voz en español:** probar las voces disponibles con texto rioplatense; registrar cuál suena aceptable (criterio subjetivo: sin acento robótico ni inglés marcado). Plan B declarado: pipeline + Edge `es-AR-ElenaNeural`.
6. **Latencia:** medir fin-de-habla→primer-audio en ≥ 10 intercambios; registrar p50/p95 (objetivo p50 ≤ 1.500 ms).
7. **Steering:** inyectar una instrucción a mitad de sesión ("en tu próxima intervención preguntá por X") y verificar que el modelo la incorpora — es el mecanismo del susurro y de los guards.
8. **Costo:** registrar tokens/costo reportados por el API para una sesión de prueba de ~5 min y extrapolar a 20 min.

Volcar resultados en `docs/specs/SPIKE_LIVE_API_RESULTADOS_v1.0.md` con: tabla criterio→resultado→evidencia, veredicto **GO / NO-GO / GO CON RESERVAS** para la Etapa 1, y los parámetros exactos que funcionaron (modelo, config de sesión, voz elegida). Si es NO-GO, el documento debe recomendar el plan B (pipeline GA + barge-in manual) con lo aprendido.

**Archivos involucrados:** `backend/scripts/spike-live-api.ts`, `docs/specs/SPIKE_LIVE_API_RESULTADOS_v1.0.md`, opcionalmente `@google/genai` como devDependency.

**Criterio de validación:** el MD de resultados existe, cada uno de los 8 criterios tiene resultado con evidencia (números, no impresiones), y hay veredicto explícito. El timebox es 1 día: si algo no se pudo probar en ese tiempo, se registra como "no verificado" — no se extiende el spike sin decisión humana.

**Depende de:** T01 (independiente de T02-T05; puede correr en paralelo si hay dos personas).

---

## Tests Obligatorios

Todos provienen de los criterios BDD del contrato de cambios (los BDD de Etapas 1-3 se cubrirán en sus planes respectivos).

### Test AC-NEW-15 — El build compila
**Dado:** main con branches integrados y T02 completada. **Cuando:** `npm run build --workspace=backend`. **Entonces:** tsc termina sin errores.
**Implementación esperada:** comando en la validación de T02 (verificación automática).

### Test AC-NEW-13 — Puesto desde formulario estructurado por leIA
**Dado:** backend con `LEIA_DRIVER=mock`. **Cuando:** POST from-form con los datos concretos del criterio (título "SSR Fullstack", descripción que menciona React/Node/Postgres, ubicación Mendoza, 2 vacantes, remoto). **Entonces:** 201 con stack/seniority/metadata correctos y el puesto sirve para agendar.
**Implementación esperada:** test en `backend/src/services/jobs/fromForm.test.ts` (builder) + curl de T02 (ruta) + paso manual de UI en la Verificación Final.

### Test AC-NEW-14 — `mode` sobrevive a Postgres
**Dado:** `DATABASE_DRIVER=postgres`, entrevista `mode='browser'`. **Cuando:** reinicio del backend y `GET /api/sala/:id/info`. **Entonces:** 200 con datos del puesto.
**Implementación esperada:** secuencia curl de la validación de T03 (semiautomática; requiere reinicio manual del proceso).

### Tests de caracterización (protegen los AC del snapshot que las Etapas 1-2 van a tocar: AC05, AC06, AC07, AC08, AC10, AC11)
**Implementación esperada:** los 10 casos de T04 en `engine.test.ts` / `analytics.test.ts`, pasando con `npx vitest run`.

---

## Verificación Final

**Automáticas:**
1. `npm run build --workspace=backend` → sin errores.
2. `cd backend && npx vitest run` → toda la suite nueva pasa.
3. `npm run build --workspace=frontend` → build de Next sin errores.
4. `git grep -n "meeting_captions\|entrevista-en-vivo" README.md SETUP.md` → vacío.

**Manuales (smoke test documentado — el repo no tiene más automatización que la creada acá):**
1. `docker compose up -d postgres` + `.env` con `DATABASE_DRIVER=postgres` + `npm run seed --workspace=backend` + `npm run dev`.
2. Abrir `http://localhost:3000/puestos/nuevo` → pestaña "Desde formulario" → cargar el puesto "SSR Fullstack" del test AC-NEW-13 → debe navegar al detalle mostrando stack detectado y metadata (ubicación, modalidad, vacantes).
3. Crear candidato en `/candidatos/nuevo`; agendar entrevista **browser** desde `/entrevistas/nueva`; en el detalle copiar el link de sala; abrirlo en otra pestaña → la entrevista arranca (leIA "habla" — con TTS mock es audio silente: verificar por los turnos que aparecen en el detalle) → cerrar la pestaña de la sala → en ~5 s la entrevista pasa a `completada` y el informe abre desde el detalle.
4. Reiniciar SOLO el proceso backend con una entrevista browser `agendada` creada antes → `GET /api/sala/:id/info` sigue 200 (AC-NEW-14).
5. Agendar entrevista **meet** con URL `https://meet.google.com/abc-defg-hij` (driver mock) → iniciar → enviar 7 respuestas con `POST /api/interviews/:id/simulate-answer` → finalize → informe completo con radar y donuts.
6. Leer `docs/specs/SPIKE_LIVE_API_RESULTADOS_v1.0.md` → tiene veredicto explícito.

Si alguna verificación falla: corregir y reintentar; si no se puede resolver dentro de los guardarraíles, reportar al humano SIN marcar el trabajo como completo.

---

## Qué Hacer al Terminar

1. Reportar: archivos creados/modificados con resumen, resultado de cada verificación (automáticas y manuales), discrepancias encontradas por los tests de caracterización (si las hubo), veredicto del spike, y tiempo total.
2. NO hacer commit ni push sin instrucción explícita del humano. Sugerencia de mensaje si se autoriza: `#etapa0 saneo: merge branches + from-form completo + mode en postgres + suite caracterizacion + spike live api`.
3. NO crear PR salvo instrucción explícita.
4. Recordar al humano los pasos post-Etapa 0: decidir go/no-go de Etapa 1 con el spike, pedir al Arquitecto los planes de Etapas 1-3, y actualizar el Mapa del Sistema (sugerencias #1-3 del MD del Arquitecto).

---

## CHANGELOG

- v1.0 (2026-07-06): Versión inicial. Cubre Etapa 0 (T01-T05) + spike Live API (T06) del contrato `ENTREVISTADOR_IA_LEIA_CAMBIOS_PROPUESTOS_v1.0.md` (mapeo: T01→T01, T02→T02, T03→T03, T04(tests)→nueva por decisión D7, T05→T04 del contrato, T06(spike)→nueva por decisión D2/CHG-INFER-01). Los planes de Etapas 1-3 se emitirán tras el cierre de esta etapa.
