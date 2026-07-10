# Análisis del Arquitecto — Ajuste de prompt: leIA debe usar el CV real (cierre de AC-NEW-06)

## 0. Metadatos

- **ID Ticket:** FIX-CV-PROMPT
- **Versión:** v1.0
- **Fecha:** 2026-07-09
- **Contrato analizado:** hallazgo con evidencia `[TEST-EXEC]` del Informe de Ejecución de ETAPA1-CIERRE (§5): en 2 corridas reales independientes contra el driver Gemini (`mode=meet`, CV distintivo), el modelo **nunca** referenció el CV — ni en preguntas, ni en evaluaciones, ni en los 2 informes (el Informe 2 llegó a señalar como debilidad "no se exploró Playwright" ignorando que el CV decía React/Cypress). AC de referencia: AC-NEW-06 del contrato `ENTREVISTADOR_IA_LEIA_CAMBIOS_PROPUESTOS_v1.0.md` §8.1.
- **Base de código verificada:** branch `feature/arnes-etapa-1-candidato`, commit `6b8fa73` = HEAD. CUMPLIDA.
- **Mapa del Sistema:** fresco.

---

## 1. Resumen Ejecutivo

- **Causa raíz confirmada contra el código:** el `cvText` llega a los prompts como un bloque de texto **mudo** — sin ninguna instrucción sobre qué hacer con él. Verificado: (a) `LEIA_SYSTEM_PROMPT` no menciona el CV en ninguna de sus 10 reglas; (b) la `cvSection` de `buildEvaluatePrompt` es solo el texto encabezado por "CV DEL CANDIDATO (...)"; (c) los system prompts de `firstQuestion` en `gemini.ts`/`claude.ts` tampoco tienen directiva; (d) `buildLiveSystemPrompt` idem.
- **Hallazgo adicional del análisis:** los informes ni siquiera **reciben** el CV — `Report1Input`/`Report2Input` no tienen el campo, `engine.generateReports()` no lo pasa, y los prompts de Report1/Report2 no lo referencian. Por eso el Informe 2 pudo "criticar" al candidato por algo que su CV respondía.
- **Diseño (D1):** directivas explícitas de uso del CV en los tres puntos de conversación — system prompt de `firstQuestion` (la apertura debe citar al menos un dato concreto del CV), regla nueva en `LEIA_SYSTEM_PROMPT` + instrucción en la `cvSection` de `buildEvaluatePrompt` (referenciar un dato concreto dentro de los primeros 3 turnos si aún no se hizo; contrastar respuestas contra el CV), y `buildLiveSystemPrompt` (misma directiva para el modo live).
- **Diseño (D2):** los informes pasan a recibir `cvText` (interfaces + engine + prompts de Report1/Report2), con la instrucción de **contrastar** lo conversado contra el CV (consistencias/inconsistencias, temas del CV no explorados) — es exactamente el valor que el Informe 2 falló en dar en la evidencia.
- **Verificación:** mismo método que destapó el hallazgo (2 corridas reales `mode=meet` + `simulate-answer` + citas textuales), más un caso de contraste deliberado (respuesta que contradice el CV) para el Informe 2. El mock no se toca (ya cumple, testeado por unidad en ETAPA1-CIERRE).
- Estimación total: **~4h** → Plan Ejecutor único.

---

## 2. Disposición de Gaps Heredados

| Gap | Disposición |
|---|---|
| Hallazgo T05 de ETAPA1-CIERRE (AC-NEW-06 no se cumple con el prompt actual) | RESUELTO por este ticket (es su objeto). |
| Riesgo R3 de ETAPA1-CIERRE (no determinismo del LLM) | PROPAGADO → R1 de este análisis: la directiva sube drásticamente la probabilidad pero no la garantiza al 100% en cada corrida; el criterio de aceptación es 2/2 corridas con al menos una referencia en los primeros 3 turnos. |

---

## 3. Diseño Técnico

### Componentes a modificar

| Archivo | Cambio |
|---|---|
| `backend/src/services/leia/prompts.ts` | Regla nueva en `LEIA_SYSTEM_PROMPT` (uso del CV); directiva en la `cvSection` de `buildEvaluatePrompt`; `cvText` opcional en `buildReport1Prompt`/`buildReport2Prompt` con sección + instrucción de contraste; instrucción de contraste en `LEIA_REPORT1_SYSTEM_PROMPT`/`LEIA_REPORT2_SYSTEM_PROMPT` (condicionada a "si hay CV"). |
| `backend/src/services/leia/index.ts` | `cvText?: string \| null` en `Report1Input` y `Report2Input`. |
| `backend/src/services/leia/gemini.ts` y `claude.ts` | Directiva de apertura con CV en el system prompt de `firstQuestion`; pasar `cvText` a `buildReport1Prompt`/`buildReport2Prompt`. |
| `backend/src/services/interview/engine.ts` | `generateReports()` pasa `cvText: this.interview.cvText` a ambos builders. |
| `backend/src/services/voice/live-session.ts` | Directiva en `buildLiveSystemPrompt` (la sección de CV pasa de bloque mudo a bloque con instrucción). |

### Decisiones de diseño

- **D1 — Directiva en tres capas (apertura / turnos / live)** (origen: análisis propio sobre la evidencia). El contenido exacto queda especificado en el plan para que el Ejecutor no improvise redacción de prompts. Principio: instrucción concreta y verificable ("referenciá al menos un dato concreto del CV — empresa, tecnología o duración — en la apertura o los primeros turnos"), no vaga ("tené en cuenta el CV").
- **D2 — Los informes reciben y contrastan el CV** (origen: pedido explícito del desarrollador de considerar Report1/Report2 + evidencia del Informe 2 fallando). Se elige pasarlo como campo opcional de los inputs existentes (mínima invasión, mismo patrón que `behavior`).
- **D3 — El mock NO se toca:** ya cumple el AC (ETAPA1-CIERRE T04) y su comportamiento está testeado. Los tests existentes no deben romperse.

---

## 4. Riesgos

| ID | Riesgo | Severidad | Mitigación |
|---|---|---|---|
| R1 | El LLM puede seguir sin citar el CV en alguna corrida (no determinismo) | Media | Directiva explícita y posicionada en system prompt (mayor obediencia que en user); criterio de aceptación: 2/2 corridas con referencia en los primeros 3 turnos; si falla, el hallazgo vuelve con la evidencia (posible escalada: mover el CV más arriba del prompt o repetir la directiva por turno). |
| R2 | Prompts más largos → más tokens por evaluación | Baja | El CV ya se enviaba (truncado a 3000 chars); el delta son ~2-4 líneas de instrucción. |
| R3 | La instrucción de contraste en informes podría hacer que el LLM invente inconsistencias | Media | La instrucción exige citar textual ("solo señalá inconsistencias si podés citar la frase del CV y la de la entrevista que chocan"); el caso de verificación 3 (contradicción deliberada) valida el comportamiento en ambos sentidos. |

---

## 5. Estimación

| Tarea | Estimación |
|---|---|
| T01 — Directivas de conversación (system + evaluate + firstQuestion + live) | 1h |
| T02 — CV en informes (interfaces + engine + prompts de reports) | 1.5h |
| T03 — Test unitario de presencia de directiva/sección | 15 min |
| T04 — Re-verificación contra Gemini real (2 corridas + caso de contraste) | 1h |
| **Total** | **~4h** → Plan Ejecutor único |

---

## 6. Actualizaciones sugeridas al Mapa del Sistema

Ninguna estructural.

---

## 7. Puntero al Plan Ejecutor

`docs/specs/ENTREVISTADOR_IA_LEIA_FIX-CV-PROMPT_PLAN_EJECUTOR_v1.0.md`

---

## CHANGELOG

- v1.0 (2026-07-09): Análisis inicial. Causa raíz verificada contra el código (bloque de CV mudo en todos los prompts; informes sin acceso al CV). Decisiones D1-D3.
