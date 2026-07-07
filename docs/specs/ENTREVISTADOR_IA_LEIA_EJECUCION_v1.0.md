# Informe de Ejecución — Arnés leIA · Etapa 0 (Saneo + Spike Live API)

## 0. Metadatos

- **ID Ticket:** N/A (alcance `ENTREVISTADOR_IA_LEIA`)
- **Versión del informe:** v1.1 (continuación — ver §9 "Spike 2" al final)
- **Fecha:** 2026-07-06
- **Producido por:** Desarrollador SDD (skill desarrollador-sdd)
- **Plan ejecutado:** `ENTREVISTADOR_IA_LEIA_PLAN_EJECUTOR_v1.0.md` + Spike 2 acotado (`ENTREVISTADOR_IA_LEIA_ARQUITECTO_v1.1.md` §3, sin Plan Ejecutor formal propio por ser una investigación de 1-2h)
- **Análisis de referencia:** `ENTREVISTADOR_IA_LEIA_ARQUITECTO_v1.0.md` + addendum `ENTREVISTADOR_IA_LEIA_ARQUITECTO_v1.1.md`
- **Branch de trabajo:** `feature/arnes-etapa-0-saneo` (desde `main`, commit de partida `0686437`)
- **Estado global:** **COMPLETA** (Etapa 0: 6/6 tareas COMPLETADA-VALIDADA; Spike 2: 3/3 pruebas ejecutadas con evidencia, veredicto final D1 sostenida y ajustada — ya no quedan decisiones pendientes bloqueando la Etapa 1)
- **Commit(s) resultantes:** sin commitear — cambios en working tree, a la espera de confirmación explícita

---

## 1. Resumen Ejecutivo

- Las 6 tareas (T01-T06) quedaron **COMPLETADA-VALIDADA** con su criterio de validación corrido de verdad (no simulado).
- **T01** confirmó que `sala-nativa`/`develop` seguían sin mergear (tal como preveía el contrato) e integró ambos por fast-forward limpio.
- **T02** completó la feature "puesto desde formulario" (tipos, `structureJob` en los 3 drivers de leIA, columnas de `jobs`, ruta, UI) y **de paso corrigió un bug real preexistente** en `detectSeniority` (el título "SSR" se clasificaba como `senior` en vez de `semi` por un regex sin límite de palabra) — autorizado explícitamente por el desarrollador.
- **T03** persistió `interviews.mode` en Postgres.
- **T04** escribió la primera suite de tests del repo (21 tests, 3 archivos) caracterizando el comportamiento real del engine — sin tests previos, cero regresiones detectables hoy pero tampoco antes.
- **T05** verificó el flujo completo en Postgres (from-link, from-form, entrevista meet con 7 turnos, entrevista browser vía WS real) y **encontró y corrigió un bug de severidad alta**: `transcripts.start_ms`/`end_ms` como `INTEGER` desbordaba con epoch-milliseconds reales, crasheando el proceso completo en cualquier entrevista real sobre Postgres. También actualizó README/SETUP resolviendo los 9 conflictos del snapshot.
- **T06** (spike Gemini Live API) dio **veredicto GO CON RESERVAS**: el núcleo funciona (conexión, audio bidireccional, transcripción de salida, voces en español), pero **barge-in no se pudo confirmar**, el **steering vía texto embebido no funcionó** (invalida el mecanismo asumido en la decisión D1 del Arquitecto) y la **latencia real (~4.7s) triplica el objetivo**. Esto **bloquea el diseño de la Etapa 1 tal como está especificado** y requiere una vuelta al Arquitecto antes de generar su Plan Ejecutor.
- **Pendiente para el humano:** decidir sobre 2 desviaciones mayores autorizadas en el momento (documentadas abajo) y sobre los hallazgos de T06 antes de continuar a la Etapa 1.

---

## 2. Estado por Tarea

| Tarea | Estado | Validación ejecutada | Resultado |
|---|---|---|---|
| T01 — Integrar branches | COMPLETADA-VALIDADA | `git rev-parse HEAD`, `git merge-base --is-ancestor origin/develop HEAD`, `npm run build --workspace=backend` | HEAD=`fa9a386` ✓; develop es ancestro ✓; build falla exactamente con los 4 errores esperados de `fromForm.ts` (estado previsto por el plan) |
| T02 — Completar "puesto desde formulario" | COMPLETADA-VALIDADA | `npx tsc --noEmit`; `POST /api/jobs/from-form` real contra backend en memoria; smoke UI en browser real | Build compila; curl devuelve 201 con stack/seniority correctos; UI (`/puestos/nuevo` → pestaña "Desde formulario") probada en browser real, navega al detalle con metadata correcta |
| T03 — `mode` en Postgres | COMPLETADA-VALIDADA | Postgres real: crear entrevista `browser`, reiniciar el proceso backend, `GET /api/sala/:id/info` | Antes del fix: 404 `sala_no_encontrada` tras reinicio. Después: 200 con los datos del puesto |
| T04 — Tests de caracterización | COMPLETADA-VALIDADA | `npx vitest run` | 21/21 tests pasan (3 archivos): `engine.test.ts` (12), `analytics.test.ts` (6), `fromForm.test.ts` (3) |
| T05 — Verificación e2e Postgres + README/SETUP | COMPLETADA-VALIDADA | Flujo completo real (from-link + from-form + candidato + entrevista meet 7 turnos + finalize + informes; entrevista browser vía cliente WS real hasta `hangup`); `git grep` de conflictos; smoke UI real (informe visual) | Ambos canales completan y persisten en Postgres; Informe 1 y 2 generados con datos reales (score 6.5/10, `segunda_instancia`, distribuciones que suman 100); grep de conflictos vacío; informe se ve correctamente en el browser |
| T06 — Spike Gemini Live API | COMPLETADA-VALIDADA | `npx tsx scripts/spike-live-api.ts` contra la API real (key de tier pago) | Los 8 criterios tienen resultado con evidencia real; veredicto **GO CON RESERVAS** (detalle en `SPIKE_LIVE_API_RESULTADOS_v1.0.md`) |

---

## 3. Log de Desviaciones

| # | Tarea | Tipo | Qué decía el plan | Qué se encontró | Qué se hizo / Disposición |
|---|---|---|---|---|---|
| D1 | T01 | Menor | Fast-forward directo de `origin/feature/sala-nativa` | `npm install` (setup previo) había modificado `package-lock.json` localmente, bloqueando el fast-forward | Se descartó el cambio local del lockfile (`git checkout -- package-lock.json`, se regenera igual con el merge) y se reintentó; sin pérdida de contenido real |
| D2 | T02 | **Mayor** | AC-NEW-13 asumía que el texto "React, Node y Postgres" + título "SSR Fullstack" produce `stack` con Node.js/PostgreSQL y `seniority='semi'` | La heurística real (`detectStack`/`detectSeniority`, reutilizada tal cual pedía T02) hace matching literal contra una lista fija (no matchea "Node"/"Postgres" sin ".js"/"SQL"), y `detectSeniority` tenía un bug de regex: `/senior\|sr\b/` matcheaba espuriamente dentro de "SSR" antes de llegar al chequeo de `semi` | **Instrucción explícita del desarrollador (`[USR]`):** (1) ajustar los datos de ejemplo usados en la validación (texto literal "Node.js"/"PostgreSQL", sin "SSR" en el título) para reflejar la heurística real; (2) corregir el bug de regex en `detectSeniority` (`fromLink.ts`) — cambio de una línea: `/senior\|sr\b/` → `/senior\|\bsr\b/`. Verificado que "Dev Sr Backend" sigue detectando `senior` correctamente tras el fix |
| D3 | — (setup) | Menor | El plan asumía `.env` en la raíz alcanza | `dotenv` no encuentra `.env` de la raíz cuando los scripts de workspace corren con `backend/` como cwd — **hallazgo real, no solo de mi entorno de ejecución** (ver Hallazgos Fuera de Alcance) | Se creó también `backend/.env` (gitignorado, mismo contenido) para poder validar; se documentó en README/SETUP como parte de T05 |
| D4 | T02/T05 | Menor | — | El bug preexistente `TypeError: seedDb is not a function` (tsx@3 + Node reciente + dynamic import, modo memoria) impedía arrancar el backend vía `npm run dev` para correr los curl/smoke de validación | Se usó el camino ya soportado por el proyecto (`npm run build` + `node dist/server.js`) para todas las validaciones runtime; documentado como hallazgo fuera de alcance (no se tocó `memory.ts`, no está en las listas del plan) |
| D5 | T05 | **Mayor** | "Flujo completo en Postgres" (criterio de T05) | `transcripts.start_ms`/`end_ms` como `INTEGER` desbordaba con epoch-ms reales (13 dígitos vs máx. ~10 de INTEGER) — **crasheaba el proceso completo** en cualquier `simulate-answer`/caption real sobre Postgres, bloqueando la validación de T05 en sí misma | **Instrucción explícita del desarrollador (`[USR]`):** migrar las columnas a `BIGINT` (`schema.sql`, patrón idempotente ya usado para `tts_driver`/`mode`) + ajustar `rowToTranscript` en `postgres.ts` para convertir el `string` que `pg` devuelve para BIGINT de vuelta a `Number` (epoch-ms cabe holgado en `Number.MAX_SAFE_INTEGER`). Verificado con el flujo e2e completo tras el fix |
| D6 | T04 | Menor | "usar fake timers de vitest para no esperar tiempos reales" | Mezclar `vi.useFakeTimers()` con timers YA programados vía `setTimeout` nativo (antes de activar el modo fake) no los captura — 3 tests fallaron por eso en el primer intento | Se rediseñó con timers reales (esperas explícitas dimensionadas a las constantes reales del engine: 700ms/4000ms + márgenes, y esperando el evento real `audio_generated` para saber cuánto dura el saludo mock ~14s antes de simular la respuesta del candidato en modo meet) — suite más lenta (~45s) pero 100% confiable |

---

## 4. Tests Obligatorios

| Test (BDD del contrato) | Archivo del test | Resultado |
|---|---|---|
| AC-NEW-15 — El build compila | Verificación de T01/T02 (`npx tsc --noEmit`, `npm run build --workspace=backend`) | PASA |
| AC-NEW-13 — Puesto desde formulario estructurado por leIA | `backend/src/services/jobs/fromForm.test.ts` (3 casos) + curl real | PASA (con datos de ejemplo ajustados — ver D2) |
| AC-NEW-14 — `mode` sobrevive a Postgres | Secuencia curl de T03 (crear entrevista browser → reiniciar proceso → `GET /api/sala/:id/info`) | PASA |
| Caracterización — commit por silencio (meet) | `engine.test.ts` | PASA |
| Caracterización — eco ignorado en modo meet | `engine.test.ts` | PASA |
| Caracterización — modo browser no bloquea por eco | `engine.test.ts` | PASA |
| Caracterización — aclaración no avanza turnIndex | `engine.test.ts` | PASA |
| Caracterización — auto-finish idempotente | `engine.test.ts` | PASA |
| Caracterización — `findSimilarQuestion` (Jaccard) | `engine.test.ts` (2 casos) | PASA |
| Caracterización — `splitSentences` | `engine.test.ts` (2 casos) | PASA |
| Caracterización — `isNeutralFiller` | `engine.test.ts` (3 casos) | PASA |
| Caracterización — `computeQualityDistribution`/`computeSentimentFallback`/`isEmptySentiment` | `analytics.test.ts` (6 casos) | PASA |

---

## 5. Verificación Final

| Verificación | Comando / Procedimiento | Resultado |
|---|---|---|
| Build backend | `npm run build --workspace=backend` | Sin errores |
| Suite de tests | `cd backend && npx vitest run` | 21/21 PASA (~45s) |
| Build frontend | `npm run build --workspace=frontend` | Sin errores, las 12 rutas compilan (incluye `/sala/[id]`) |
| Grep de conflictos README/SETUP | `git grep -n "meeting_captions\|entrevista-en-vivo\|Vertex AI" README.md SETUP.md package.json` | Vacío (limpio) |
| Smoke manual — Postgres + seed + puesto por formulario en UI real | Docker Postgres real, seed, backend+frontend levantados, formulario "QA Automation Semi" completado y enviado en el browser | EJECUTADO: navega al detalle con stack `Cypress, Playwright` detectado y metadata persistida |
| Smoke manual — entrevista meet completa | curl real: from-link → candidato → entrevista meet → start → 7 `simulate-answer` (con polling por avance de turno, no tiempos fijos) → finalize | EJECUTADO: 8 turnos, informes 1 y 2 generados; informe visual verificado en browser (score 6.5/10, "Segunda instancia") |
| Smoke manual — entrevista browser completa | Cliente WS real contra `/ws/sala/:id`: `ready` → pregunta → `transcript` → siguiente pregunta → `hangup` | EJECUTADO: `status: completada`, 2 turnos, 2 reports en Postgres |
| Reinicio con entrevista en curso (AC-NEW-14) | Ver tabla de tareas, T03 | EJECUTADO |

### Guion de smoke test manual (para quien retome — reproducible en 5 minutos)

1. `docker compose up -d postgres`; `.env` y `backend/.env` con `DATABASE_DRIVER=postgres` (resto mock/edge).
2. `npm run seed --workspace=backend` (usa el build compilado si `npm run dev` falla en modo memoria — no aplica en postgres).
3. `npm run dev` desde la raíz (o `node backend/dist/server.js` + `cd frontend && npm run dev` si se prefiere evitar `tsx watch`).
4. Abrir `http://localhost:3000/puestos/nuevo`, pestaña "Desde formulario", completar y enviar → debe navegar al detalle con stack detectado.
5. Agendar una entrevista modo `browser` desde `/entrevistas/nueva`, copiar el link de sala, abrirlo → debe arrancar sola y, tras responder y cerrar la pestaña, completarse con informe generado.

---

## 6. Archivos Tocados

Coincide con `git status --short` del branch `feature/arnes-etapa-0-saneo`.

**Creados:**
- `backend/vitest.config.ts` — config mínima de vitest
- `backend/src/services/interview/engine.test.ts` — 12 tests de caracterización del engine
- `backend/src/services/interview/analytics.test.ts` — 6 tests de las distribuciones determinísticas
- `backend/src/services/jobs/fromForm.test.ts` — 3 tests del builder from-form
- `backend/scripts/spike-live-api.ts` — sonda del spike T06
- `docs/specs/SPIKE_LIVE_API_RESULTADOS_v1.0.md`, `docs/specs/ENTREVISTADOR_IA_LEIA_EJECUCION_v1.0.md` (este informe)

**Modificados:**
- `backend/src/types.ts` — tipos `JobModality`/`JobHiringStatus`, campos nuevos de `Job`, flag `behavioralAnalysisEnabled`
- `frontend/lib/types.ts` — espejo de lo anterior
- `backend/src/services/leia/index.ts` — interface `structureJob`
- `backend/src/services/leia/mock.ts` — implementación heurística de `structureJob`
- `backend/src/services/leia/gemini.ts`, `claude.ts` — implementación LLM de `structureJob`
- `backend/src/services/jobs/fromLink.ts` — export de helpers reutilizables + **fix del bug de `detectSeniority`** (D2) + campos nuevos de Job
- `backend/src/services/jobs/fromForm.ts` — flag `behavioralAnalysisEnabled`
- `backend/src/db/schema.sql` — columnas nuevas de `jobs`, `interviews.mode`, **`transcripts.start_ms`/`end_ms` a BIGINT** (D5)
- `backend/src/db/postgres.ts` — mapping de las columnas nuevas + fix de conversión BIGINT→Number (D5)
- `backend/src/db/seed.ts` — campos nuevos en el job demo
- `backend/src/routes/jobs.ts` — ruta `POST /api/jobs/from-form`
- `backend/src/services/interview/engine.ts` — export de `findSimilarQuestion`, `splitSentences`, `isNeutralFiller` (sin cambio de lógica)
- `frontend/lib/api.ts` — `apiCreateJobFromForm`
- `frontend/app/puestos/nuevo/page.tsx` — pestañas "Desde link"/"Desde formulario"
- `README.md`, `SETUP.md` — resolución de los 9 conflictos del snapshot + documentación de capacidades por canal
- `package.json` (raíz) — descripción corregida (ya no menciona Vertex AI)
- `backend/package.json`, `package-lock.json` — `@google/genai` como devDependency (spike T06)

**Fuera de las listas del plan (con justificación):**
- `.claude/launch.json` — creado para poder levantar el frontend con las Preview tools y hacer el smoke test en browser real, tal como pide la guía del proyecto para cambios de UI. No es código de producción.
- `backend/scripts/debug-live.ts` — residuo de la investigación del spike (T06); el sandbox de esta sesión bloqueó su eliminación (`rm: Operation not permitted`). Se vació su contenido a un stub inofensivo; **recomendado borrarlo manualmente** (`rm backend/scripts/debug-live.ts`).

---

## 7. Hallazgos Fuera de Alcance

- **`backend/src/db/memory.ts:27` / `backend/src/db/seed.ts` (import dinámico de `seedDb`):** incompatibilidad real entre `tsx@3.14.0` (versión fijada en `backend/package.json`) y Node ≥20 (confirmado en Node 24) en la resolución de imports dinámicos. Rompe `npm run dev` y `npm run seed` **específicamente en `DATABASE_DRIVER=memory`** (el default de la demo — afecta el "Arrancar en 3 minutos" del README tal como estaba). No afecta al build compilado (`npm run build` + `node dist/...`) ni a `DATABASE_DRIVER=postgres`. Sugerencia de fix (no aplicado, fuera de las listas de T01-T06): cambiar el `await import('./seed')` dinámico por un `import { seedDb } from './seed'` estático al tope de `memory.ts`.
- **Sidebar del frontend (`frontend/components/Layout.tsx`):** texto hardcodeado "Captions nativos de Meet · leIA" — mismo problema que el conflicto de README ya corregido, pero en la UI. No tocado (fuera de las listas del plan).
- **`npm audit`:** 5 vulnerabilidades reportadas tras `npm install` (preexistentes, no introducidas por este plan). No evaluadas ni corregidas — recomendar `npm audit` dedicado en un pase aparte.

---

## 8. Pendientes y Próximos Pasos

- [x] ~~Decisión del Arquitecto sobre T06~~ — **Resuelto en el Spike 2** (§9 abajo): D1 sostenida y ajustada, veredicto final en `SPIKE_LIVE_API_RESULTADOS_v1.1.md`.
- [ ] **Borrar manualmente** `backend/scripts/debug-live.ts` (bloqueado por el sandbox de esta sesión).
- [ ] **Borrar manualmente** `docs/specs/SPIKE_LIVE_API_RESULTADOS_v1.0.md` (superseded por v1.1; el sandbox tampoco permitió `mv`/`rm` en esta continuación — ver §9).
- [ ] Confirmar si se quiere commitear esta Etapa 0 + Spike 2 (sin commits hechos, a la espera de instrucción explícita) y con qué mensaje.
- [ ] Considerar un ticket aparte para el hallazgo `seedDb`/`tsx@3` (afecta la experiencia de arranque en memoria) y para el string desactualizado del sidebar.
- [ ] Actualizar `docs/specs/ARQUITECTURA_DEL_SISTEMA.md` con lo aprendido (sugerencias #1-3 ya identificadas en el `ARQUITECTO_v1.0.md`, más el veredicto final de Live API).
- [ ] **Siguiente paso natural:** pedir al Arquitecto el Plan Ejecutor de la Etapa 1, ahora que D1' está resuelta (incorporando los 5 ajustes del veredicto final: `thinkingConfig.thinkingBudget=0`, barge-in vía audio paceado, mecanismo alternativo para el susurro, no depender de la transcripción de Live para análisis fino, modelo `gemini-2.5-flash-native-audio-latest`).

---

## 9. Continuación — Spike 2 (3 pruebas puntuales sobre D1)

- **Origen:** `ENTREVISTADOR_IA_LEIA_ARQUITECTO_v1.1.md` §3, instrucción del desarrollador: "volvé al arquitecto para que revise los hallazgos a ver qué sugiere", y luego "sí" a ejecutar el spike acotado que el Arquitecto propuso.
- **Alcance:** sin Plan Ejecutor formal (investigación acotada de 1-2h autorizada directamente por el desarrollador); se ejecutó como continuación de esta misma ejecución.
- **Archivo modificado:** `backend/scripts/spike-live-api.ts` (se agregaron 4 tests nuevos: F, G, H1, H2 — sin tocar los tests A-E existentes).
- **Comando:** `cd backend && npx tsx scripts/spike-live-api.ts` (corrido completo; A-E se repitieron sin cambios de comportamiento relevantes respecto al Spike 1, F-H son los nuevos).

### Estado de las 3 pruebas

| Prueba | Estado | Resultado |
|---|---|---|
| F — Latencia con `thinkingConfig.thinkingBudget=0` | COMPLETADA-VALIDADA | ✅ Mejora: 1296ms (vs. 4342-4851ms sin el flag) |
| G — Steering vía `tools`/function-calling | COMPLETADA-VALIDADA | ❌ Sigue sin funcionar: el modelo no invocó la herramienta declarada |
| H1/H2 — Barge-in y transcripción de entrada con audio paceado a tiempo real | COMPLETADA-VALIDADA | ✅ Barge-in confirmado (621ms de detección); ⚠️ transcripción de entrada de términos técnicos sigue mal (hallazgo nuevo, no resuelto por el pacing) |

**Resultado: 2 de 3 mejoraron → según el criterio pre-acordado con el Arquitecto, D1 se sostiene, ajustada.** Veredicto completo y los 5 ajustes de diseño en `SPIKE_LIVE_API_RESULTADOS_v1.1.md` §"Veredicto final: D1 sostenida y ajustada (D1')".

### Desviación registrada

| # | Tipo | Detalle |
|---|---|---|
| D7 | Menor | El sandbox de esta sesión volvió a bloquear `mv`/`rm` sobre `docs/specs/SPIKE_LIVE_API_RESULTADOS_v1.0.md` al intentar renombrarlo a v1.1 (mismo comportamiento que con `debug-live.ts` en la Etapa 0). Se creó el archivo v1.1 con el contenido completo (Spike 1 + Spike 2) y se dejó un stub de redirección en el v1.0, igual patrón que la vez anterior. |

### Archivos tocados en esta continuación

- **Modificado:** `backend/scripts/spike-live-api.ts` (+4 tests)
- **Creado:** `docs/specs/SPIKE_LIVE_API_RESULTADOS_v1.1.md`, `docs/specs/ENTREVISTADOR_IA_LEIA_ARQUITECTO_v1.1.md` (generado por el Arquitecto, no por mí)
- **Convertido a stub:** `docs/specs/SPIKE_LIVE_API_RESULTADOS_v1.0.md` (ver D7)
- Este informe (`ENTREVISTADOR_IA_LEIA_EJECUCION_v1.0.md`) pasa a v1.1 en sus metadatos, conservando el nombre de archivo original.

### Verificación final de esta continuación

- `npx tsc --noEmit --esModuleInterop --skipLibCheck --target es2022 --module commonjs --moduleResolution node scripts/spike-live-api.ts` → sin errores.
- `npx tsc --noEmit` (proyecto completo) → sin errores.
- Script corrido de punta a punta contra la API real, sin errores no controlados; los 4 tests nuevos produjeron resultados con evidencia (JSON completo en el log de ejecución y resumido en `SPIKE_LIVE_API_RESULTADOS_v1.1.md`).

---

## CHANGELOG

- v1.0 (2026-07-06): Ejecución inicial del plan v1.0. Estado global: COMPLETA CON PENDIENTES. Tareas: 6/6 COMPLETADA-VALIDADA, 0 bloqueadas, 0 omitidas. Desviaciones: 4 menores, 2 mayores (ambas resueltas con instrucción explícita del desarrollador).
- v1.1 (2026-07-06): Continuación — Spike 2 (3 pruebas puntuales sobre D1, sin Plan Ejecutor formal). Estado global pasa a COMPLETA (ya no quedan decisiones bloqueantes para la Etapa 1). 1 desviación menor nueva (D7, mismo patrón de sandbox que en v1.0).
