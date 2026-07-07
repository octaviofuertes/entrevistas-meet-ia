# Informe de Ejecución — Hotfix: 415 en el upload de grabaciones

## 0. Metadatos

- **ID Ticket:** HOTFIX-RECORDING-415
- **Versión del informe:** v1.0
- **Fecha:** 2026-07-07
- **Producido por:** Desarrollador SDD (skill desarrollador-sdd)
- **Plan ejecutado:** `ENTREVISTADOR_IA_LEIA_HOTFIX-RECORDING-415_PLAN_EJECUTOR_v1.0.md` (metadatos v1.1 — la v1.0 quedó parcialmente ejecutada y fue corregida por el Arquitecto tras una desviación mayor, ver Log de Desviaciones)
- **Análisis de referencia:** `ENTREVISTADOR_IA_LEIA_HOTFIX-RECORDING-415_ARQUITECTO_v1.0.md` (metadatos v1.1)
- **Branch de trabajo:** `feature/arnes-etapa-1-candidato` (commit de partida `e3d0dc6`)
- **Estado global:** COMPLETA (los 2 sub-checks de regresión inicialmente bloqueados por entorno se re-corrieron y pasaron tras resolver el conflicto de puerto, ver §7)
- **Commit(s) resultantes:** ver reporte final (commit en `feature/arnes-etapa-1-candidato` autorizado por el desarrollador)

---

## 1. Resumen Ejecutivo

- El 415 de `POST /api/sala/:id/recording` está resuelto: el endpoint acepta `video/webm`/`video/mp4` (pelados o con parámetros RFC-válidos) hasta 500MB, y el handler stub (log + ack) quedó intacto.
- Durante la ejecución del plan v1.0 se detectó una **desviación mayor**: el header que emite el navegador (`video/webm;codecs=vp9,opus`) es RFC-inválido (coma sin comillas) y Fastify no consulta los parsers RegExp ante headers imparseables. Se devolvió al Arquitecto, que emitió el plan v1.1 (decisión D4): el frontend normaliza el `Content-Type` al media type pelado.
- Tests: 1a (pelado→200), 1b (codecs con comillas→200), 1c (malformado→415 por diseño), 2 (30MB→200) y 3a/3b/3c (regresiones JSON, PDF y zip→415) **pasan con salida real verificada** — 3a/3b requirieron resolver primero una caída de Postgres ajena al hotfix (ver §7).
- Verificación final automatizada: builds backend y frontend limpios, suite vitest 27/27.

---

## 2. Estado por Tarea

| Tarea | Estado | Validación ejecutada | Resultado |
|---|---|---|---|
| T01 — Parser `/^video\//` | COMPLETADA-VALIDADA | build + curl Tests 1a/1b/2 | `video/webm` y `video/mp4` → 200 con bytes correctos |
| T02 — bodyLimit 500MB por-ruta + nota streaming | COMPLETADA-VALIDADA | curl Test 2 (30MB) | `bytes:30000000` / HTTP 200 (el límite global de 10MB habría dado 413) |
| T03 (v1.1) — Normalizar Content-Type + warn en catch | COMPLETADA-VALIDADA | `npm run build --workspace=frontend` | Build limpio; fetch envía `blob.type.split(';')[0] \|\| 'video/webm'` y el catch loguea `console.warn` |

---

## 3. Log de Desviaciones

| # | Tarea | Tipo | Qué decía el plan | Qué se encontró | Qué se hizo / Disposición |
|---|---|---|---|---|---|
| D1 | T01 (plan v1.0) | **Mayor** | El parser RegExp `/^video\//` aceptaría `video/webm;codecs=vp9,opus` (Test 1 del plan v1.0 lo exigía con HTTP 200) | El header es inválido según RFC 7231 (coma sin comillas en el valor del parámetro); `fast-content-type-parse` devuelve tipo vacío (verificado con node) y `getParser` de Fastify (`contentTypeParser.js:106-108`) retorna temprano sin consultar la lista de RegExp. Ningún parser backend puede matchearlo. | Se frenó T01 y se reportó con evidencia. El desarrollador dispuso **volver al Arquitecto**, que emitió el plan v1.1 (decisión D4: normalizar el Content-Type en el frontend). Ejecución retomada y completada sobre v1.1. |

---

## 4. Tests Obligatorios

| Test (plan v1.1) | Procedimiento | Resultado |
|---|---|---|
| 1a — Media type pelado → 200 | curl `Content-Type: video/webm`, body 100KB | PASA: `{"ok":true,...,"bytes":100000}` / HTTP 200 |
| 1b — Codecs RFC-válidos (comillas) → 200 | curl `Content-Type: video/webm;codecs="vp9,opus"` | PASA: HTTP 200 |
| 1c — Header malformado → 415 por diseño | curl `Content-Type: video/webm;codecs=vp9,opus` | PASA: HTTP 415 (comportamiento correcto según D4; el frontend ya no emite este header) |
| 2 — Grabación >10MB → 200 | curl `Content-Type: video/mp4`, body 30MB | PASA: `bytes:30000000` / HTTP 200 |
| 3c — Content-type no registrado → 415 | curl `Content-Type: application/zip` | PASA: HTTP 415 (el fix no abrió la puerta a todo) |
| 3a — JSON sigue funcionando | curl POST `/api/interviews` con JSON | PASA: entrevista creada (200/201). Primera corrida dio 500 por la BD caída (28P01, entorno); re-corrida con la BD arriba, pasa completa. |
| 3b — CV `application/pdf` sigue funcionando | curl POST `/api/sala/:id/cv` con el PDF fixture | PASA: `{"ok":true,"extracted":true}` / HTTP 200 (re-corrida con la BD arriba). |

---

## 5. Verificación Final

| Verificación | Comando | Resultado |
|---|---|---|
| Build backend | `npm run build --workspace=backend` | OK (exit 0) |
| Build frontend | `npm run build --workspace=frontend` | OK (exit 0) |
| Suite de tests | `cd backend && npx vitest run` | 27/27 PASS (5 archivos) |
| Tests curl 1a/1b/1c/2/3c | ver §4 | PASS con salida real |
| Tests curl 3a/3b (happy path completo) | ver §4 | PASS (re-corridos con la BD arriba tras resolver el conflicto de puerto) |
| Smoke opcional (grabación real desde el navegador) | REC en una entrevista browser → log `grabación recibida` con bytes > 0 | PENDIENTE DEL HUMANO (requiere sesión con cámara/mic reales; el camino ya está verificado vía curl) |

---

## 6. Archivos Tocados

- **Modificados:**
  - `backend/src/realtime/browser-sala.ts` — parser `/^video\//` (parseAs buffer) + `bodyLimit: 500MB` en la ruta de recording + nota de streaming para el ticket de persistencia.
  - `frontend/app/sala/[id]/page.tsx` — fetch de grabación: `Content-Type` normalizado al media type pelado + `console.warn` en el catch (antes silencioso).
- **Creados:** ninguno (los 3 MDs del ticket en `docs/specs/` son artefactos del pipeline, no código).
- **Fuera de las listas del plan:** ninguno (verificado con `git status`).

---

## 7. Hallazgos Fuera de Alcance

- **Conflicto de puertos entre proyectos:** el container `entrevistas-postgres` recibió un shutdown (~14:27 UTC) y el container `leia-core-postgres-1` (otro proyecto de la máquina) tomó el puerto 5432, impidiendo que `entrevistas-postgres` re-arrancara. Con autorización `[USR]` se frenó `leia-core-postgres-1` y se levantó `entrevistas-postgres` (los datos del otro proyecto persisten en su volumen; se re-arranca con `docker start leia-core-postgres-1`, pero va a colisionar de nuevo mientras ambos compose mapeen 5432). **Gestión sugerida:** remapear el puerto en uno de los dos `docker-compose` para que puedan convivir.

---

## 8. Pendientes y Próximos Pasos

- [ ] **Humano (opcional):** smoke con grabación real desde el navegador (REC → colgar → log `grabación recibida` con bytes > 0). El camino ya está verificado vía curl.
- [ ] Ticket futuro ya anotado por el Arquitecto: persistencia real de la grabación con streaming (no buffer en memoria).
- [ ] Remapear puertos de Postgres entre `entrevistas-meet-ia` y `leia-core` para evitar la colisión recurrente (§7).

---

## CHANGELOG

- v1.0 (2026-07-07): Ejecución del plan v1.0→v1.1 con una desviación mayor (D1, header RFC-inválido) resuelta vía re-análisis del Arquitecto. Estado global: COMPLETA. Tareas: 3/3 completadas-validadas. Tests: 7/7 PASS (3a/3b re-corridos tras resolver el conflicto de puerto de Postgres con autorización [USR]).
