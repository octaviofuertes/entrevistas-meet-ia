# Plan de Ejecución — Ajuste de prompt: leIA debe usar el CV real (AC-NEW-06)

## Metadatos

- **Ticket:** FIX-CV-PROMPT
- **Versión:** v1.0
- **Fecha:** 2026-07-09
- **Origen:** `ENTREVISTADOR_IA_LEIA_FIX-CV-PROMPT_ARQUITECTO_v1.0.md` (hallazgo T05 de ETAPA1-CIERRE, evidencia en su Informe de Ejecución §5).
- **Destinatario:** Agente Ejecutor (Codificador).
- **Base de código requerida:** branch `feature/arnes-etapa-1-candidato`, commit `6b8fa73` (verificada como HEAD).
- **Stack y comandos:** monorepo npm workspaces. Backend: `npm run build --workspace=backend`, `cd backend && npx vitest run`. Postgres local en host **5433** (`docker compose up -d postgres`). Auth admin: `Authorization: Bearer admin-demo-token-cambiar`. Para T04: `GEMINI_API_KEY` válida y `LEIA_DRIVER=gemini` **en `backend/.env`** (ojo: `dotenv.config({override:true})` pisa las variables del shell — editar el archivo, restaurar al terminar).

---

## Misión

Que leIA use efectivamente el CV del candidato en las entrevistas con drivers LLM reales: la apertura o los primeros turnos deben referenciar al menos un dato concreto del CV, y los informes finales deben contrastar lo conversado contra el CV — verificado con corridas reales contra Gemini con citas textuales como evidencia.

---

## Guardarraíles (No Negociables)

- **NO tocar** `backend/src/services/leia/mock.ts` ni sus tests: el mock ya cumple el AC (ETAPA1-CIERRE T04). La suite completa debe seguir verde sin modificar ningún test existente.
- **NO cambiar** la estructura JSON de salida de ningún prompt (los parsers de `gemini.ts`/`claude.ts` dependen de ella).
- Las secciones de CV en los prompts siguen condicionadas a la presencia de `cvText`: **sin CV, los prompts deben quedar byte-a-byte como hoy** (sin secciones vacías ni menciones al CV).
- El texto de las directivas es el especificado en las tareas — no improvisar redacciones alternativas.
- Sin dependencias nuevas.

---

## Entorno de Ejecución

- `docker compose up -d postgres` + backend (`npx tsx src/server.ts` desde `backend/`).
- Health check: `curl -H "Authorization: Bearer admin-demo-token-cambiar" http://localhost:4000/api/health` → `"status":"ok"` (verificar que `drivers.leia` diga `gemini` durante T04).
- T04 usa `mode=meet` (el recall mock de meet soporta `POST /api/interviews/:id/simulate-answer`; el de browser no).

---

## Archivos a Crear

Ninguno.

## Archivos a Modificar

1. `backend/src/services/leia/prompts.ts`
2. `backend/src/services/leia/index.ts`
3. `backend/src/services/leia/gemini.ts`
4. `backend/src/services/leia/claude.ts`
5. `backend/src/services/interview/engine.ts`
6. `backend/src/services/voice/live-session.ts`
7. `backend/src/services/leia/prompts.test.ts` (si no existe archivo de tests de prompts, crearlo — es la excepción a "Archivos a Crear: ninguno", declarada acá)

---

## Tareas (Orden Topológico)

### T01 — Directivas de conversación

**Qué hacer:**

1. **`prompts.ts` — `LEIA_SYSTEM_PROMPT`:** agregar como regla 11 (después de la regla 10 "NO seas servil..."):
```
11. Si el turno incluye una sección "CV DEL CANDIDATO": usalo activamente. Referenciá al menos UN dato concreto del CV (empresa, tecnología, duración, proyecto) dentro de los primeros 3 turnos si todavía no lo hiciste, y usá el CV para elegir ángulos de pregunta y detectar coincidencias o contradicciones con lo que el candidato responde.
```

2. **`prompts.ts` — `buildEvaluatePrompt`:** la `cvSection` pasa de bloque mudo a bloque con directiva:
```ts
const cvSection = input.cvText
  ? `\nCV DEL CANDIDATO (texto extraído, puede tener errores de formato — usalo según la regla 11 del system prompt):\n${truncate(input.cvText, 3000)}\n`
  : '';
```

3. **`gemini.ts` y `claude.ts` — system prompt de `firstQuestion`:** donde hoy se arma `cvSection` para el mensaje user, agregar además al final del system prompt (solo si hay CV):
```
- El candidato subió su CV (viene en el mensaje). Tu apertura DEBE referenciar al menos un dato concreto del CV (empresa, tecnología o duración) — natural, sin recitarlo.
```
(Implementación sugerida: construir el sys con un condicional `input.cvText ? regla : ''`, mismo patrón que ya usa la interpolación existente.)

4. **`live-session.ts` — `buildLiveSystemPrompt`:** la sección de CV pasa a:
```
 CV del candidato (texto extraído, puede tener errores de formato): ${...}. Usalo activamente: referenciá al menos un dato concreto del CV en tus primeras preguntas y contrastá lo que el candidato cuenta con lo que dice su CV.
```

**Criterio de validación:** `npm run build --workspace=backend` sin errores.

**Depende de:** Ninguna.

---

### T02 — CV en los informes

**Qué hacer:**

1. **`index.ts`:** agregar `cvText?: string | null;` a `Report1Input` y `Report2Input`.
2. **`engine.ts` — `generateReports()`:** pasar `cvText: this.interview.cvText` en las llamadas a `buildReport1` y `buildReport2` (líneas ~731 y ~763).
3. **`prompts.ts`:** `buildReport1Prompt` y `buildReport2Prompt` aceptan `cvText?: string | null` y, si está presente, anteponen al final del prompt user:
```
CV DEL CANDIDATO (texto extraído):
<cvText truncado a 3000>
```
4. **`prompts.ts` — `LEIA_REPORT1_SYSTEM_PROMPT` y `LEIA_REPORT2_SYSTEM_PROMPT`:** agregar (en la sección de reglas de precisión de cada uno):
```
- Si se incluye el CV del candidato: contrastá la entrevista contra el CV. Señalá coincidencias confirmadas, temas relevantes del CV que NO se exploraron, e inconsistencias — pero SOLO señalá una inconsistencia si podés citar la frase del CV y la frase de la entrevista que chocan. No inventes.
```
5. **`gemini.ts` y `claude.ts`:** pasar `cvText: input.cvText` en las llamadas internas a `buildReport1Prompt`/`buildReport2Prompt`.

**Criterio de validación:** `npm run build --workspace=backend` sin errores; suite completa verde (el mock ignora el campo nuevo opcional — no debe romperse nada).

**Depende de:** T01 (mismos archivos).

---

### T03 — Test unitario de las secciones

**Qué hacer:** en `backend/src/services/leia/prompts.test.ts` (crear si no existe), casos mínimos:
1. `buildEvaluatePrompt` con `cvText` → el resultado contiene "CV DEL CANDIDATO" y "regla 11".
2. `buildEvaluatePrompt` sin `cvText` → el resultado NO contiene "CV".
3. `buildReport2Prompt` con `cvText` → contiene "CV DEL CANDIDATO"; sin `cvText` → no lo contiene.
4. `LEIA_SYSTEM_PROMPT` contiene la regla 11 (aserción de contención simple).

**Criterio de validación:** `cd backend && npx vitest run` → suite completa verde con los casos nuevos.

**Depende de:** T02.

---

### T04 — Re-verificación contra Gemini real

**Qué hacer (ejecución, no código):** repetir el método de ETAPA1-CIERRE T05:
1. Setear `LEIA_DRIVER=gemini` en `backend/.env`, reiniciar backend, confirmar `drivers.leia: "gemini"` en el health.
2. **Corridas 1 y 2 (apertura + primeros turnos):** entrevista `mode=meet` con `meetUrl` de fantasía, CV distintivo ("Trabajé 3 años en MercadoLibre como frontend developer, usando React y Cypress" — subir vía `POST /api/sala/:id/cv`), `start`, 2 respuestas vía `simulate-answer`, y verificar en los turnos persistidos que **al menos una pregunta de los primeros 3 turnos referencia un dato concreto del CV** (MercadoLibre / 3 años / React). Criterio: 2/2 corridas.
3. **Caso de contraste (Informe 2):** en una de las corridas, responder algo que contradiga el CV (ej. "la verdad nunca usé React, siempre trabajé con Angular") y, tras finalizar la entrevista, verificar que el Informe 2 lo señala citando ambas partes (o al menos lo menciona como inconsistencia); verificar además que el Informe 1/2 mencionan el CV.
4. Restaurar `LEIA_DRIVER=mock` en `backend/.env` y reiniciar el backend al terminar.
5. Pegar las citas textuales reales (preguntas + fragmentos de informes) en el Informe de Ejecución.

**Criterio de validación:** citas textuales con la referencia al CV en 2/2 corridas + el resultado del caso de contraste. Si tras 2 corridas la referencia no aparece: NO iterar redacciones de prompt por cuenta propia — reportar el resultado crudo (nueva iteración del Arquitecto, posible escalada de diseño).

**Depende de:** T01-T03.

---

## Tests Obligatorios

| Criterio | Cobertura |
|---|---|
| AC-NEW-06 — referencia verificable al CV en los primeros 3 turnos (driver real) | T04 pasos 1-2 (2 corridas reales, citas textuales) |
| AC-NEW-06 — sin CV, comportamiento intacto | T03 casos 2-3 (prompts idénticos sin CV) + suite completa verde |
| Contraste en informes (extensión D2) | T04 paso 3 (caso de contradicción deliberada) |

---

## Verificación Final

1. `npm run build --workspace=backend` → sin errores.
2. `npm run build --workspace=frontend` → sin errores (no debería haber cambios).
3. `cd backend && npx vitest run` → suite completa verde (38 + los de T03).
4. T04 completo con evidencia textual.
5. Confirmar al final: `backend/.env` restaurado (`LEIA_DRIVER=mock`) y health mostrando `leia: "mock"`.

---

## Qué Hacer al Terminar

1. Informe de Ejecución con las citas textuales de T04 y el estado final de AC-NEW-06 (COMPLETO / NO CUMPLE con evidencia).
2. NO hacer commit/push sin confirmación explícita.

---

## CHANGELOG

- v1.0 (2026-07-09): Versión inicial. Directivas de CV en conversación (D1), CV en informes con instrucción de contraste (D2), mock intocado (D3), re-verificación real con caso de contradicción.
