# Análisis del Arquitecto — Hotfix: 415 en el upload de grabaciones

> **Corrección v1.1 (2026-07-07):** el Ejecutor devolvió un hallazgo durante la ejecución del plan v1.0: la decisión D1 (parser RegExp) es **insuficiente por sí sola** para el caso reportado. Ver §3-bis. El plan fue reversionado a v1.1 con la decisión D4.

## 0. Metadatos

- **ID Ticket:** HOTFIX-RECORDING-415
- **Versión:** v1.1
- **Fecha:** 2026-07-07
- **Contrato analizado:** no hay contrato del Elicitador — el input es el hallazgo fuera de alcance §7 de `ENTREVISTADOR_IA_LEIA_ETAPA1_EJECUCION_v1.0.md`, con decisión de alcance `[USR]` del desarrollador ("solo arreglar el 415, sin agregar persistencia"). Se registra como excepción deliberada al pipeline por tratarse de un hotfix acotado; el hallazgo original tiene evidencia `[TEST-EXEC]` (curl real con respuesta 415 documentada).
- **Base de código verificada:** branch `feature/arnes-etapa-1-candidato`, commit `e3d0dc6` = HEAD actual. CUMPLIDA.
- **Mapa del Sistema:** `docs/specs/ARQUITECTURA_DEL_SISTEMA.md`, fresco (2026-07-06, 1 commit posterior).

---

## 1. Resumen Ejecutivo

- `POST /api/sala/:id/recording` devuelve **415 Unsupported Media Type** ante cualquier upload real: Fastify rechaza el body antes de que el handler corra, porque no existe content-type parser para `video/webm`/`video/mp4` (solo hay para `application/json`, `text/plain` y `application/pdf`).
- El frontend envía `Content-Type: blob.type`, que incluye parámetros de codecs (ej. `video/webm;codecs=vp9,opus`) — el fix debe cubrir el tipo con parámetros, no solo el tipo pelado.
- **Hallazgo adicional de este análisis:** el `bodyLimit` global es 10MB (`server.ts:21`); una grabación real de ~20 min lo supera con facilidad, por lo que arreglar solo el parser dejaría al endpoint fallando con **413** en el caso de uso real. Consultado con el desarrollador (Fase 3): se aprobó subir el límite **solo en esta ruta** a 500MB.
- También aprobado en Fase 3: reemplazar el `.catch(() => {})` silencioso del frontend (que ocultó este bug) por un `console.warn` de una línea. El upload sigue siendo fire-and-forget.
- El comportamiento del handler **no cambia**: loguea bytes y responde `{ok:true}` — la persistencia real (disco/S3) queda explícitamente fuera de alcance, para un ticket futuro con su propio contrato.
- Estimación total: **~1h** → un único Plan Ejecutor (gate de granularidad no disparado).

---

## 2. Disposición de Gaps Heredados

El input no es un contrato del Elicitador, así que no trae gaps estructurados. Los dos puntos abiertos detectados en la exploración se resolvieron por consulta directa (Fase 3):

| # | Punto abierto | Disposición |
|---|---|---|
| 1 | `bodyLimit` global de 10MB haría que el fix del 415 derive en 413 con grabaciones reales | RESUELTO → `[USR]` aprobó bodyLimit por-ruta de 500MB (T02 del plan) |
| 2 | `.catch(() => {})` silencioso en el frontend ocultó el bug | RESUELTO → `[USR]` aprobó `console.warn` mínimo (T03 del plan) |

---

## 3. Diseño Técnico

### Componentes a modificar

| Archivo | Cambio |
|---|---|
| `backend/src/realtime/browser-sala.ts` | (a) Registrar content-type parser por RegExp `/^video\//` con `parseAs: 'buffer'`, junto al parser de `application/pdf` ya existente (mismo patrón de encapsulación de plugin); (b) agregar `bodyLimit: 500MB` a las opciones de la ruta `/api/sala/:id/recording`. |
| `frontend/app/sala/[id]/page.tsx` | `.catch(() => {})` del fetch de grabación → `.catch(err => console.warn(...))`. |

### Decisiones de diseño

- **D1 — Parser por RegExp, no por string:** `/^video\//` matchea `video/webm`, `video/mp4` y cualquier variante con parámetros de codecs, y cubre futuros contenedores sin tocar código. Se registra dentro de `browserSalaRoute()` — la encapsulación de plugins de Fastify garantiza que no afecta al resto del sistema (patrón ya validado con `application/pdf` en la Etapa 1).
- **D2 — bodyLimit por-ruta (500MB), no global:** Fastify permite `bodyLimit` en las opciones de la ruta. 500MB cubre ~40 min de grabación 720p; el límite global de 10MB del resto del sistema queda intacto. Origen: consulta Fase 3, aprobado `[USR]`.
- **D3 — Sin persistencia:** el handler sigue siendo un stub (log + ack). Decisión de alcance `[USR]` previa a este análisis.

---

## 3-bis. Hallazgo del Ejecutor (v1.1) y decisión D4

**Hallazgo (con evidencia `[TEST-EXEC]`):** el header que emite el navegador — `Content-Type: video/webm;codecs=vp9,opus`, tomado tal cual de `blob.type` — es **inválido según RFC 7231**: el valor `vp9,opus` contiene una coma sin comillas (la forma válida es `codecs="vp9,opus"`). El parser spec-compliant de Fastify (`fast-content-type-parse`) devuelve tipo vacío ante ese header (verificado con node contra la librería real), y `getParser` (`fastify/lib/contentTypeParser.js:106-108`) retorna temprano buscando un catch-all `''` **sin consultar nunca la lista de parsers RegExp**. Conclusión: ningún parser registrable en el backend puede matchear ese header; el supuesto de D1 ("la RegExp cubre los parámetros de codecs") era incorrecto para este caso puntual.

**Verificado también por el Ejecutor:** el parser RegExp de D1 sí funciona para `video/webm` pelado (HTTP 200 real) — sigue siendo necesario, solo que no alcanza.

**Opciones evaluadas:**

| Opción | Trade-off |
|---|---|
| (a) Normalizar el header en el frontend (`blob.type.split(';')[0]`) | El navegador deja de emitir un header malformado (corrige el problema en la fuente); el backend queda estricto; cambio de 1 línea en un archivo ya en alcance (T03). **Elegida.** |
| (b) Catch-all `''` en el backend | Funciona, pero amplía la semántica de TODAS las rutas del plugin de la sala ante cualquier header basura, y el frontend seguiría emitiendo un header inválido. Descartada. |

**Decisión D4 (origen: hallazgo del Ejecutor + análisis propio; el desarrollador devolvió la disposición al Arquitecto):** opción (a). T03 del plan pasa a incluir la normalización del `Content-Type` además del `console.warn`. D1 (parser RegExp) se mantiene: cubre `video/webm`/`video/mp4` pelados (lo que el frontend va a emitir tras D4) y variantes con parámetros *válidos* (ej. `codecs="vp9,opus"` con comillas, cuyo essence sí se parsea).

**Consecuencia sobre los tests:** el Test 1 del plan v1.0 (curl con el header malformado esperando 200) era inválido — ese header **debe** seguir dando 415, porque tras D4 el frontend ya no lo emite y aceptarlo requeriría la opción (b) descartada. El plan v1.1 lo redefine: el caso con parámetros se prueba con la forma RFC-válida (comillas), y el header malformado queda documentado como 415 esperado.

---

## 4. Riesgos

| ID | Riesgo | Severidad | Mitigación |
|---|---|---|---|
| R1 | `parseAs: 'buffer'` retiene la grabación completa en memoria (hasta 500MB por request) | Media | Aceptado para el stub actual (el body se descarta tras loguear). El ticket futuro de persistencia DEBE migrar a streaming (`parseAs` omitido + `req.raw` pipe a disco/S3) — dejar nota en el código. |
| R2 | Un cliente malicioso podría subir 500MB repetidamente a una ruta sin auth (`skipAuth`) | Baja (demo) | Aceptado: la ruta ya era sin auth por diseño (el candidato no tiene token). Anotar para el ticket de persistencia (rate limit / validación de interviewId activo). |

---

## 5. Estimación

| Tarea | Estimación |
|---|---|
| T01 — Parser `video/*` | 15 min |
| T02 — bodyLimit por-ruta | 10 min |
| T03 — warn en el catch del frontend | 5 min |
| T04 — Verificación (curl + regresión + suite) | 30 min |
| **Total** | **~1h** → Plan Ejecutor único |

---

## 6. Actualizaciones sugeridas al Mapa del Sistema

Ninguna estructural. Opcional: anotar en la sección de la sala nativa que `/api/sala/:id/recording` es un stub sin persistencia (ya lo dice el código).

---

## 7. Puntero al Plan Ejecutor

`docs/specs/ENTREVISTADOR_IA_LEIA_HOTFIX-RECORDING-415_PLAN_EJECUTOR_v1.0.md`

---

## CHANGELOG

- v1.1 (2026-07-07): Hallazgo del Ejecutor incorporado (§3-bis): el header con codecs del navegador es RFC-inválido y Fastify no consulta las RegExp ante headers imparseables. Decisión D4: normalizar el Content-Type en el frontend (T03 ampliada). Test 1 del plan redefinido. Plan reversionado a v1.1.
- v1.0 (2026-07-07): Análisis inicial del hotfix. Dos consultas Fase 3 resueltas (bodyLimit por-ruta y warn en catch), ambas aprobadas.
