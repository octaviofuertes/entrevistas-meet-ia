# Plan de Ejecución — Etapa 1, Ticket 04: CV del Candidato en el Contexto de leIA

## Metadatos

- **Ticket:** ETAPA1-04 (de 4)
- **Versión:** v1.0
- **Fecha:** 2026-07-06
- **Origen:** Análisis del Arquitecto SDD — ver `ENTREVISTADOR_IA_LEIA_ETAPA1_ARQUITECTO_v1.0.md` §3-4, contrato T09 / AC-NEW-06 / Outcome H de `ENTREVISTADOR_IA_LEIA_CAMBIOS_PROPUESTOS_v1.0.md`.
- **Destinatario:** Agente Ejecutor (Codificador).
- **Base de código requerida:** branch `feature/arnes-etapa-1-candidato` (puede ejecutarse **en paralelo** con ETAPA1-01/02/03 — no depende de ninguno, según la tabla de partición confirmada; si el Ejecutor lo hace secuencialmente sobre el mismo branch, no hay conflicto de archivos esperado).
- **Stack y comandos:** igual que los tickets anteriores de esta etapa. Requiere agregar la librería `pdf-parse` (o equivalente ya evaluado — confirmar disponibilidad en npm sin costo de licencia) a `backend/package.json`.
- **Decisión de scope ya tomada (Fase 3, confirmada con el desarrollador):** "Upload PDF + extracción simple" — NO se implementa parsing estructurado (extracción de secciones tipo experiencia/educación), solo texto plano completo del PDF inyectado como contexto adicional al system prompt.

---

## Misión

Permitir que el candidato suba su CV en PDF antes o durante el lobby, extraer el texto plano, y que ese texto esté disponible como contexto adicional para leIA (tanto en modo `pipeline` como en modo `live`), para que pueda hacer preguntas más específicas y personalizadas.

---

## Guardarraíles (No Negociables)

### Lo que NO se modifica
- El flujo de entrevista sin CV debe seguir funcionando exactamente igual (el CV es un enriquecimiento opcional, nunca un requisito para iniciar la entrevista).
- No se implementa ningún parseo estructurado ni matching automático de skills contra el puesto en este ticket — eso quedaría, si se decide en el futuro, para una etapa posterior.

### Convenciones a respetar
- Manejo de errores de extracción de PDF: si `pdf-parse` falla (PDF corrupto, protegido, escaneado sin texto, etc.), la entrevista debe continuar SIN el contexto del CV, con un log de advertencia — nunca debe bloquear el inicio de la entrevista (Riesgo R16).
- Tamaño de archivo: aplicar un límite razonable (ej. 5MB) consistente con otros límites de upload si existen en el proyecto (revisar si hay convención ya establecida para uploads).
- El texto extraído se persiste en la tabla `interviews` (columna nueva) — no se crea una tabla nueva para esto, es un campo de texto simple.

---

## Entorno de Ejecución

- Igual que los tickets anteriores (Postgres + backend + frontend locales).
- Se necesita al menos un PDF de prueba (CV real o de ejemplo) para el smoke test — puede generarse uno simple con cualquier editor si no hay uno a mano.

---

## Archivos a Crear

1. Ninguno estrictamente nuevo si se integra en rutas existentes de `interviews` — si el Ejecutor prefiere un archivo dedicado para la extracción, crear `backend/src/services/interview/cv.ts` con la función `extractCvText(buffer: Buffer): Promise<string | null>`.
2. `backend/src/services/interview/cv.test.ts` — tests de la función de extracción (con un PDF de fixture simple) y del manejo de error ante buffer inválido.

## Archivos a Modificar

1. `backend/package.json` — agregar `pdf-parse` a `dependencies`.
2. `backend/src/db/schema.sql` + `backend/src/db/postgres.ts` — columna `interviews.cv_text TEXT` (nullable, sin default — ausencia de CV es un estado válido y distinto de string vacío).
3. `backend/src/types.ts` + `frontend/lib/types.ts` — `Interview.cvText?: string | null`.
4. `backend/src/routes/interviews.ts` (o el archivo de rutas de entrevistas existente — confirmar nombre exacto en el código real antes de editar) — nuevo endpoint `POST /api/interviews/:id/cv` que acepta `multipart/form-data` con el PDF, lo procesa con `extractCvText`, y persiste `cvText`.
5. `backend/src/services/leia/index.ts` (y los 3 drivers: `mock.ts`, `gemini.ts`, `claude.ts`) — el contexto de `cvText`, si existe, se agrega al prompt de `firstQuestion`/`evaluate` (texto plano, sección clara tipo "CV del candidato:" antepuesta o anexada al prompt existente, sin cambiar la firma de los métodos si es posible — evaluar si conviene agregarlo al objeto `Interview`/`Candidate` que ya reciben esos métodos en vez de agregar un parámetro nuevo).
6. `backend/src/services/voice/live-session.ts` (creado en ETAPA1-02) — el `buildLiveSystemPrompt` (o equivalente) debe incluir el `cvText` si está presente, mismo criterio que el punto anterior.
7. `frontend/app/sala/[id]/page.tsx` — en el lobby (junto a los checkboxes de consentimiento de ETAPA1-01), agregar un input de tipo archivo opcional ("Subí tu CV (PDF, opcional)") que, al seleccionarse, sube el archivo al nuevo endpoint antes de habilitar "Unirse ahora" (o de forma asíncrona sin bloquear el botón — decisión menor del Ejecutor, documentar cuál se eligió).
8. `frontend/lib/api.ts` — nueva función `apiUploadCv(interviewId, file)`.

---

## Tareas (Orden Topológico)

### T01 — Dependencia y función de extracción

**Qué hacer:**
1. Agregar `pdf-parse` a `backend/package.json` (`dependencies`), `npm install`.
2. Crear `extractCvText(buffer: Buffer): Promise<string | null>` en `backend/src/services/interview/cv.ts`:
```ts
import pdfParse from 'pdf-parse';
import { logger } from '../../logger';

export async function extractCvText(buffer: Buffer): Promise<string | null> {
  try {
    const result = await pdfParse(buffer);
    const text = result.text?.trim();
    return text && text.length > 0 ? text : null;
  } catch (err) {
    logger.warn({ err }, 'No se pudo extraer texto del CV, la entrevista continúa sin este contexto');
    return null;
  }
}
```

**Archivos:** `backend/src/services/interview/cv.ts`, `backend/package.json`.

**Criterio de validación:** `npm run build --workspace=backend` sin errores.

**Depende de:** Ninguna.

---

### T02 — Tests de extracción

**Qué hacer:** en `backend/src/services/interview/cv.test.ts`:
1. Con un buffer de PDF simple válido (generar uno de fixture, mínimo texto), confirmar que `extractCvText` devuelve el texto esperado (o al menos un string no vacío que lo contenga).
2. Con un buffer inválido (ej. `Buffer.from('esto no es un pdf')`), confirmar que `extractCvText` devuelve `null` sin lanzar excepción.

**Archivos:** `backend/src/services/interview/cv.test.ts`.

**Criterio de validación:** `cd backend && npx vitest run` → nuevos tests pasan.

**Depende de:** T01.

---

### T03 — Columna, tipos y endpoint de upload

**Qué hacer:**
1. Migración idempotente: `ALTER TABLE interviews ADD COLUMN IF NOT EXISTS cv_text TEXT;` (sin constraint, nullable).
2. Agregar `cvText` a `Interview` (backend/frontend) y al mapping de `postgres.ts`.
3. Nuevo endpoint (confirmar primero el archivo de rutas real de entrevistas explorando `backend/src/routes/` — usar el nombre de archivo y patrón de registro de rutas que ya exista en el proyecto, no inventar uno nuevo): `POST /api/interviews/:id/cv`, multipart, límite 5MB, llama `extractCvText`, persiste `cvText` en la entrevista, responde `{ ok: true, extracted: boolean }` (para que el frontend pueda avisar si no se pudo extraer texto, sin bloquear el flujo).

**Archivos:** `backend/src/db/schema.sql`, `backend/src/db/postgres.ts`, `backend/src/types.ts`, `frontend/lib/types.ts`, archivo de rutas de entrevistas (confirmar nombre real).

**Criterio de validación:**
```bash
npm run build --workspace=backend
docker exec entrevistas-postgres psql -U entrevistas -d entrevistas -c "\d interviews" | grep cv_text
curl -F "file=@/ruta/a/un/cv.pdf" http://localhost:PUERTO/api/interviews/ID/cv   # 200, extracted:true
```

**Depende de:** T01.

---

### T04 — Inyección del CV en los prompts (pipeline y live)

**Qué hacer:** en `services/leia/index.ts` y los 3 drivers, y en `services/voice/live-session.ts`, agregar el texto del CV (si `interview.cvText` está presente) como sección adicional del prompt/system instruction, con un encabezado claro (ej. `"CV del candidato (texto extraído, puede tener errores de formato):\n${cvText}"`), en un punto donde no rompa la estructura de prompt existente (revisar cómo están armados los prompts actuales antes de insertar — mantener el mismo estilo).

**Archivos:** `backend/src/services/leia/index.ts`, `mock.ts`, `gemini.ts`, `claude.ts`, `backend/src/services/voice/live-session.ts`.

**Criterio de validación:** test unitario (agregar caso a los tests existentes de `leia` si los hay, o smoke manual) confirmando que el prompt final incluye el texto del CV cuando está presente, y es idéntico a antes cuando no lo está (no debe agregar una sección vacía o con texto tipo "undefined").

**Depende de:** T03, ETAPA1-02 (para el archivo `live-session.ts`, que debe existir ya).

---

### T05 — Upload desde el frontend

**Qué hacer:** en el lobby de `frontend/app/sala/[id]/page.tsx`, agregar un input de archivo opcional (aceptar solo `.pdf`), con una función `apiUploadCv` en `frontend/lib/api.ts` que hace el POST multipart. Mostrar un mensaje simple de éxito/error (sin bloquear "Unirse ahora" en ningún caso — el CV es siempre opcional).

**Archivos:** `frontend/app/sala/[id]/page.tsx`, `frontend/lib/api.ts`.

**Criterio de validación:** `npm run build --workspace=frontend` sin errores; smoke manual (ver Verificación Final).

**Depende de:** T03.

---

## Tests Obligatorios

### Test AC-NEW-06 — CV disponible como contexto
**Dado:** un candidato sube su CV en PDF antes de iniciar la entrevista. **Cuando:** la entrevista arranca (modo `pipeline` o `live`). **Entonces:** el prompt/system instruction enviado al driver de leIA incluye el texto extraído del CV.
**Implementación esperada:** cubierto por T04 (test unitario) + smoke manual.

### Test — CV inválido no bloquea
**Dado:** un candidato sube un archivo que no es un PDF válido o un PDF sin texto extraíble. **Cuando:** se procesa el upload. **Entonces:** la entrevista sigue siendo iniciable normalmente, sin el contexto del CV, sin error visible para el usuario que impida continuar.
**Implementación esperada:** cubierto por T02 (`extractCvText` devuelve `null`) + T03 (endpoint no falla, responde `extracted:false`).

---

## Verificación Final

**Automáticas:**
1. `npm run build --workspace=backend` y `--workspace=frontend` → sin errores.
2. `cd backend && npx vitest run` → toda la suite pasa, incluyendo los nuevos tests de `cv.test.ts`.

**Manual (smoke test):**
1. Levantar el stack completo.
2. Crear una entrevista, entrar al lobby, subir un CV en PDF de prueba.
3. Confirmar (log del backend o respuesta del endpoint) que se extrajo texto.
4. Iniciar la entrevista y confirmar (revisando el log de la llamada al driver de leIA, o agregando un log temporal si hace falta) que el prompt incluye el texto del CV.
5. Repetir sin subir CV — confirmar que la entrevista arranca igual que siempre, sin ninguna sección vacía o rota en el prompt.
6. Repetir subiendo un archivo no-PDF (ej. una imagen renombrada a `.pdf`) — confirmar que no se rompe el endpoint ni el inicio de la entrevista.

---

## Qué Hacer al Terminar

1. Reportar archivos creados/modificados, resultado de cada verificación, y confirmar el nombre real del archivo de rutas usado (por si difiere de la suposición de este plan).
2. NO hacer commit/push sin instrucción explícita.

---

## CHANGELOG

- v1.0 (2026-07-06): Versión inicial. Cubre T09 del contrato de Cambios Propuestos.
