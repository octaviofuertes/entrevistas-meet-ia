# Plan de Ejecución — Hotfix: 415 en el upload de grabaciones

## Metadatos

- **Ticket:** HOTFIX-RECORDING-415
- **Versión:** v1.1 (v1.0 quedó parcialmente ejecutada: T01 y T02 aplicadas y validadas para tipos pelados; el delta de esta versión es T03 ampliada y los tests redefinidos — ver CHANGELOG)
- **Fecha:** 2026-07-07
- **Origen:** `ENTREVISTADOR_IA_LEIA_HOTFIX-RECORDING-415_ARQUITECTO_v1.0.md` (hallazgo §7 del Informe de Ejecución de la Etapa 1, alcance confirmado `[USR]`).
- **Destinatario:** Agente Ejecutor (Codificador).
- **Base de código requerida:** branch `feature/arnes-etapa-1-candidato`, commit `e3d0dc6` (verificada como HEAD al momento del análisis). Trabajar sobre el mismo branch.
- **Stack y comandos:** monorepo npm workspaces. Backend: `npm run build --workspace=backend`, `cd backend && npx vitest run`. Frontend: `npm run build --workspace=frontend`. Postgres local: `docker compose up -d postgres`. Auth API admin: `Authorization: Bearer admin-demo-token-cambiar`.

---

## Misión

Que `POST /api/sala/:id/recording` deje de responder 415 y reciba efectivamente el body de la grabación (incluidas grabaciones reales de decenas de MB), manteniendo el handler exactamente como está (log de bytes + ack, sin persistencia), y que un fallo futuro del upload deje rastro en la consola del navegador.

---

## Guardarraíles (No Negociables)

- **NO agregar persistencia** de la grabación (ni disco ni S3): el handler queda como stub. Es alcance explícito de un ticket futuro.
- **NO tocar el `bodyLimit` global** de `server.ts` (10MB) ni ningún parser fuera de `browser-sala.ts`.
- **NO modificar** el comportamiento del resto de las rutas de `browser-sala.ts` (info, WS, finalize, cv).
- El upload del frontend sigue siendo fire-and-forget: el `console.warn` no debe agregar reintentos, estados de UI ni bloquear el flujo de fin de llamada.

---

## Entorno de Ejecución

- `docker compose up -d postgres` + `backend/.env` con `DATABASE_DRIVER=postgres` → levantar backend (`npx tsx src/server.ts` desde `backend/`, o build compilado).
- Health check: `curl -H "Authorization: Bearer admin-demo-token-cambiar" http://localhost:4000/api/health` → `"status":"ok"`.
- No se necesita frontend corriendo para la verificación principal (es vía curl); solo para el check visual opcional del paso 3 del smoke.

---

## Archivos a Crear

Ninguno.

## Archivos a Modificar

1. `backend/src/realtime/browser-sala.ts`
2. `frontend/app/sala/[id]/page.tsx`

---

## Tareas (Orden Topológico)

### T01 — Content-type parser para `video/*`

**Qué hacer:** en `backend/src/realtime/browser-sala.ts`, junto al parser existente de `application/pdf` (línea ~24), registrar:

```ts
// La grabación llega como video crudo (webm/mp4, con parámetros de codecs
// según el navegador, ej. "video/webm;codecs=vp9,opus").
app.addContentTypeParser(/^video\//, { parseAs: 'buffer' }, (_req, body, done) => {
  done(null, body);
});
```

**Criterio de validación:** `npm run build --workspace=backend` sin errores.

**Depende de:** Ninguna.

---

### T02 — bodyLimit por-ruta en `/api/sala/:id/recording`

**Qué hacer:** en la definición de la ruta (línea ~164), agregar `bodyLimit` a las opciones:

```ts
app.post(
  '/api/sala/:id/recording',
  { config: { skipAuth: true }, bodyLimit: 500 * 1024 * 1024 },
  ...
```

Agregar además, en el comentario existente del handler ("en producción guardar en disco/S3"), la nota: `al implementar persistencia, migrar a streaming (sin parseAs buffer) — 500MB en memoria por request no escala`.

**Criterio de validación:** `npm run build --workspace=backend` sin errores.

**Depende de:** T01.

---

### T03 — Normalizar Content-Type y warn en el catch del upload (frontend)

**Qué hacer:** en `frontend/app/sala/[id]/page.tsx` (línea ~433-435), cambiar el fetch de la grabación:

```ts
fetch(`${API_URL}/api/sala/${id}/recording`, {
  method: 'POST', headers: { 'Content-Type': blob.type }, body: blob,
}).catch(() => {});
```

por:

```ts
// blob.type puede traer codecs con coma sin comillas ("video/webm;codecs=vp9,opus"),
// que es inválido según RFC 7231 y el backend lo rechaza con 415 — mandamos solo
// el media type pelado.
fetch(`${API_URL}/api/sala/${id}/recording`, {
  method: 'POST', headers: { 'Content-Type': blob.type.split(';')[0] || 'video/webm' }, body: blob,
}).catch((err) => console.warn('sala: no se pudo subir la grabación', err));
```

**Criterio de validación:** `npm run build --workspace=frontend` sin errores.

**Depende de:** Ninguna (paralelizable con T01/T02).

---

## Tests Obligatorios

El hallazgo original se descubrió con curl real; la verificación replica exactamente ese método (el proyecto no tiene infraestructura de tests de integración HTTP — `server.ts` no exporta `buildServer` y refactorizarlo está fuera del alcance de este hotfix).

### Test 1 — El 415 desaparece para los headers que el frontend emite tras T03
**Dado:** backend corriendo. **Cuando:** se sube un body binario con el media type pelado (lo que el frontend normalizado envía) o con parámetros RFC-válidos (codecs entre comillas). **Entonces:** responde 200 con `{ok:true, bytes:<n>}` y el log muestra `grabación recibida`.
```bash
head -c 100000 /dev/urandom > /tmp/fake-recording.webm
# 1a. Media type pelado (caso principal post-T03):
curl -s -w "\nHTTP:%{http_code}\n" -X POST \
  -H "Content-Type: video/webm" \
  --data-binary @/tmp/fake-recording.webm \
  http://localhost:4000/api/sala/cualquier-id/recording
# Esperado: {"ok":true,"interviewId":"cualquier-id","bytes":100000} / HTTP:200
# 1b. Parámetros RFC-válidos (codecs con comillas):
curl -s -w "\nHTTP:%{http_code}\n" -X POST \
  -H 'Content-Type: video/webm;codecs="vp9,opus"' \
  --data-binary @/tmp/fake-recording.webm \
  http://localhost:4000/api/sala/cualquier-id/recording
# Esperado: HTTP:200
# 1c. Header malformado (coma sin comillas — lo que el navegador emitía antes de T03):
curl -s -w "\nHTTP:%{http_code}\n" -X POST \
  -H "Content-Type: video/webm;codecs=vp9,opus" \
  --data-binary @/tmp/fake-recording.webm \
  http://localhost:4000/api/sala/cualquier-id/recording
# Esperado: HTTP:415 — comportamiento CORRECTO por diseño (decisión D4 del Arquitecto):
# el header es inválido según RFC 7231 y el frontend ya no lo emite. NO intentar "arreglarlo".
```

### Test 2 — Grabación grande (>10MB, el caso que el bodyLimit global rechazaría)
```bash
head -c 30000000 /dev/urandom > /tmp/big-recording.webm
curl -s -w "\nHTTP:%{http_code}\n" -X POST \
  -H "Content-Type: video/mp4" \
  --data-binary @/tmp/big-recording.webm \
  http://localhost:4000/api/sala/cualquier-id/recording
# Esperado: bytes:30000000 / HTTP:200 (antes del fix: 413 o 415)
```

### Test 3 — Regresión: el resto de los parsers no cambió
```bash
# JSON sigue funcionando (crear entrevista o health):
curl -s -H "Authorization: Bearer admin-demo-token-cambiar" http://localhost:4000/api/health   # 200
# El upload de CV (application/pdf) sigue funcionando:
curl -s -X POST -H "Content-Type: application/pdf" \
  --data-binary @backend/src/services/interview/cv-sample.pdf \
  http://localhost:4000/api/sala/<ID-ENTREVISTA-BROWSER>/cv
# Esperado: {"ok":true,"extracted":true}
# Un content-type NO registrado sigue dando 415 (el fix no abrió la puerta a todo):
curl -s -w "\nHTTP:%{http_code}\n" -X POST -H "Content-Type: application/zip" \
  --data-binary "x" http://localhost:4000/api/sala/cualquier-id/recording
# Esperado: HTTP:415
```

---

## Verificación Final

**Automáticas:**
1. `npm run build --workspace=backend` → sin errores.
2. `npm run build --workspace=frontend` → sin errores.
3. `cd backend && npx vitest run` → 27/27 tests siguen pasando.

**Manual:**
4. Tests 1, 2 y 3 de arriba, con las salidas reales anotadas.
5. (Opcional, si hay frontend y navegador a mano) Entrevista browser real con REC activado → al colgar, el log del backend debe mostrar `grabación recibida` con bytes > 0.

---

## Qué Hacer al Terminar

1. Reportar archivos modificados, salida real de los 3 tests curl y resultado de la suite.
2. NO hacer commit/push sin confirmación explícita.
3. Recordar en el reporte que la persistencia real de la grabación sigue pendiente como ticket futuro (con streaming, ver nota de T02).

---

## CHANGELOG

- v1.1 (2026-07-07): Corrección tras hallazgo del Ejecutor (ver §3-bis del MD del Arquitecto v1.1): el header con codecs del navegador es RFC-inválido y Fastify no consulta los parsers RegExp ante headers imparseables — ningún parser backend puede aceptarlo. T03 ampliada: además del warn, el frontend normaliza el Content-Type al media type pelado (`blob.type.split(';')[0]`). Test 1 redefinido (1a/1b esperan 200; 1c —header malformado— espera 415 por diseño). T01 y T02 sin cambios (ya aplicadas y validadas para tipos pelados en la ejecución parcial de v1.0).
- v1.0 (2026-07-07): Versión inicial del hotfix. Alcance: parser `video/*` + bodyLimit por-ruta + warn en catch. Sin persistencia (explícitamente fuera de alcance).
