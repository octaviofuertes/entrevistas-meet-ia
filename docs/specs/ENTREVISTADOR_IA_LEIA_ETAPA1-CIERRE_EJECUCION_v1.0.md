# Informe de Ejecución — Cierre de la Etapa 1: sesiones Live largas + CV verificable

## 0. Metadatos

- **ID Ticket:** ETAPA1-CIERRE
- **Versión del informe:** v1.0
- **Fecha:** 2026-07-09
- **Producido por:** Desarrollador SDD (skill desarrollador-sdd)
- **Plan ejecutado:** `ENTREVISTADOR_IA_LEIA_ETAPA1-CIERRE_PLAN_EJECUTOR_v1.0.md`
- **Análisis de referencia:** `ENTREVISTADOR_IA_LEIA_ETAPA1-CIERRE_ARQUITECTO_v1.0.md`
- **Branch de trabajo:** `feature/arnes-etapa-1-candidato` (commit de partida `e351530`)
- **Estado global:** COMPLETA CON HALLAZGOS. Grupo A (código) completado y validado; el soak real dio evidencia positiva parcial con una anomalía de entorno documentada. Grupo B: el mock (T04) cumple el AC; la verificación contra el driver real (T05) **confirma que el AC-NEW-06 no se cumple hoy** — hallazgo reportado, no corregido en este pase (requiere ajuste de prompt, decisión del Arquitecto).
- **Commit(s) resultantes:** sin commitear — cambios en working tree

---

## 1. Resumen Ejecutivo

- **AC-NEW-04 (sesiones Live largas):** `VoiceSession` ahora configura `sessionResumption` + `contextWindowCompression`, guarda el handle recibido, y reconecta ante `goAway` o cierre inesperado (máx. 2 intentos). El soak real confirmó con evidencia **que los handles de resumption SE RECIBEN y SE USAN con éxito**: tras una interrupción de conectividad muy larga (ver §5, anomalía de entorno), `VoiceSession` reconectó exitosamente dos veces seguidas usando el último handle guardado — cierra la incertidumbre del riesgo R1 del análisis (si el proveedor emite handles alguna vez: SÍ). El chequeo final de responsividad post-reconexión no dio señal positiva dentro de los 8s de espera — punto abierto, detallado en §5.
- **AC-NEW-06 (CV real):** el mock ahora cita contenido concreto del CV (validado por unidad). Contra el driver Gemini real, **en 2 corridas independientes de 2 turnos cada una, el CV nunca fue referenciado** — ni en las preguntas, ni en las evaluaciones, ni en los 2 informes finales generados — pese a que `cvText` llega correctamente al prompt (verificado). Es un hallazgo confirmado, no una decisión de diseño del Ejecutor: reportado para el Arquitecto (ajuste de prompt).
- Verificación automatizada: builds limpios (backend y frontend), vitest 38/38 (11 tests nuevos: 5 de `shouldReconnect`, 6 del mock/CV).
- **Hallazgo fuera de alcance encontrado durante la verificación:** un error de red no capturado en `msedge-tts` (fallback de TTS) tira abajo todo el proceso del backend (`ETIMEDOUT` sin catch). Ya estaba presente antes de este ticket; no se tocó (no está en el alcance del plan). Recomendado como ticket de robustez aparte.
- **Anomalías de entorno durante la ejecución** (no relacionadas con el código): el daemon de Docker se cayó a mitad de la sesión (se reinició); hubo gaps de reloj de pared muy largos entre pasos de esta sesión de trabajo (minutos/horas) que afectaron la limpieza del soak. Documentado en detalle en §5 para que la interpretación de la evidencia sea honesta.

---

## 2. Estado por Tarea

| Tarea | Estado | Validación ejecutada | Resultado |
|---|---|---|---|
| T01 — Config resumption/compression + goAway/handle en onmessage | COMPLETADA-VALIDADA | `npm run build --workspace=backend` | Build limpio |
| T02 — openSession/reconnect + política de reintentos | COMPLETADA-VALIDADA | build + `shouldReconnect` unit tests (5 casos) + soak real | Build limpio; función pura testeada; reconexión real confirmada en el soak (ver §5) |
| T03 — Script de soak + corrida real | COMPLETADA-VALIDADA-CON-HALLAZGO | Corrida real única, ~3h de reloj de pared (con anomalía, ver §5) | Evidencia positiva de resumption + reconexión; chequeo final de responsividad sin confirmar limpiamente |
| T04 — Mock con referencia concreta al CV | COMPLETADA-VALIDADA | `cd backend && npx vitest run` (6 tests nuevos) | Todos pasan |
| T05 — Verificación AC-NEW-06 contra Gemini real | COMPLETADA-CON-HALLAZGO-NEGATIVO | 2 corridas reales (`mode=meet`, `LEIA_DRIVER=gemini`, CV distintivo, 2 turnos c/u) | El CV NUNCA fue referenciado en ninguna corrida — AC-NEW-06 no se cumple con el prompt actual |

---

## 3. Log de Desviaciones

| # | Tarea | Tipo | Qué decía el plan | Qué se encontró | Qué se hizo |
|---|---|---|---|---|---|
| D1 | T03/T05 (entorno) | Menor | El entorno local (Docker, backend) se asumía estable durante la ejecución | El daemon de Docker se cayó a mitad de sesión (`Cannot connect to the Docker daemon`); el backend se cayó una vez por un crash preexistente de `msedge-tts` (ver Hallazgos §7) | Se relanzó Docker (`open -a Docker`), se re-levantó `entrevistas-postgres`, se reinició el backend. Ninguna pérdida de código; sí se perdió el estado en memoria de una entrevista en curso (interview `d0730a7c...`), abandonada y reemplazada por una nueva (`60e580da...`) para completar la 2ª corrida de T05. |
| D2 | T05 | Menor | El plan preveía "hasta 2 corridas" para AC-NEW-06 | Ambas corridas dieron el mismo resultado negativo (0 referencias al CV en 2+2 turnos, evaluaciones y 2 informes) | Se reportó como hallazgo confirmado (no aislado/azaroso) en vez de intentar una 3ª corrida — el patrón es consistente, no ruido estadístico. Disposición: Arquitecto. |

Sin desviaciones mayores sobre el código en sí (el diseño D1-D3 del Arquitecto se implementó tal como estaba especificado).

---

## 4. Tests Obligatorios

| AC del contrato | Cobertura | Resultado |
|---|---|---|
| AC-NEW-04 — Sesión Live de 20+ min | Soak real (T03) | PARCIAL — ver §5 para el detalle honesto de la evidencia |
| AC-NEW-06 — leIA usa el CV real | T04 (mock, 6 unit tests) + T05 (2 corridas reales contra Gemini) | Mock: PASA. Driver real: **NO PASA** (hallazgo confirmado, ver §5) |

---

## 5. Evidencia y hallazgos detallados

### AC-NEW-04 — Soak real

Comando: `LOG_LEVEL=debug npx tsx scripts/soak-live-session.ts` (SOAK_MINUTES=13 por default). Corrido una sola vez, en background.

**Lo que pasó, con honestidad:** la corrida se extendió por **~3.16 horas de reloj de pared** (11363s totales) en vez de los ~13 minutos previstos — no porque el soak se colgara indefinidamente en su propio código, sino porque hubo gaps muy largos entre pasos de esta sesión de trabajo (el proceso quedó corriendo, suspendido junto con el resto del entorno, y continuó al reanudarse). Esto termina siendo, sin buscarlo, una prueba MÁS exigente que la planeada: una interrupción real de conectividad de duración indeterminada, mucho más allá del límite de ~10 min documentado.

**Hallazgo positivo (cierra el riesgo R1 del análisis):** en el evento de reanudación, el log muestra:
```
22:49:45.416 voice-session: reconectado con handle de resumption
22:49:46.837 voice-session: reconectado con handle de resumption
```
Dos reconexiones exitosas seguidas, usando el handle de `sessionResumptionUpdate` guardado. **Esto confirma que el proveedor SÍ emite handles utilizables y que la reconexión de `VoiceSession` funciona de punta a punta contra la API real** — la incertidumbre que el análisis marcaba como riesgo alto (R1: "podría no emitir handles nunca") queda resuelta a favor: sí los emite y sí sirven para reconectar.

**Punto abierto:** el chequeo final (`sendTextInstruction` + esperar 8s por audio de respuesta) dio `respondedAtEnd: false` — tras las dos reconexiones, la sesión no confirmó estar respondiendo dentro de la ventana de espera. No se pudo determinar con esta corrida si: (a) la sesión reconectada perdió continuidad conversacional real, (b) 8 segundos es insuficiente tras una reconexión reciente, o (c) el hallazgo es un artefacto de la anomalía de reloj (ej. el proceso reanudándose en un estado transitorio). `audioChunksTotal: 786` a lo largo de la corrida confirma que SÍ hubo mucha actividad de audio normal antes del incidente.

**Nota técnica menor:** los logs de nivel `debug` ("nuevo handle de resumption") no aparecieron pese a `LOG_LEVEL=debug` en el shell — `config.ts` usa `dotenv.config({override:true})`, que pisa la variable de entorno del shell con el valor (ausente → default `info`) de `backend/.env`. No afecta la evidencia (la reconexión exitosa ya prueba que el handle existía), pero si se quiere reintentar el soak con logs de debug, hay que setear `LOG_LEVEL=debug` dentro de `backend/.env` en vez de por shell.

**Recomendación:** si se quiere una confirmación limpia de AC-NEW-04 sin el ruido de esta anomalía, correr el soak de nuevo en una sesión sin gaps de reloj de pared (ej. lanzado y esperado de punta a punta sin interrupciones), o subir el timeout del chequeo final a 15-20s.

### AC-NEW-06 — Verificación contra Gemini real

Dos corridas, `mode=meet`, `LEIA_DRIVER=gemini` (vía edición temporal de `backend/.env`, restaurado a `mock` al terminar), mismo CV distintivo (`Ana Pérez... Trabajé 3 años en MercadoLibre como frontend developer, usando React y Cypress.`).

**Corrida 1** (interview `8e02e73e...`), 3 turnos:
- T0: *"¡Hola Ana! ... ¿qué te motivó a explorar el mundo del testing automatizado...?"* — sin CV.
- T1: *"Mirá vos, qué interesante eso de la velocidad de Cypress..."* — sin CV.
- T2: *"¡Qué bueno que lo pudiste resolver así!..."* — sin CV.

**Corrida 2** (interview `60e580da...`), 2 turnos completos + 2 informes:
- T0/T1: sin CV.
- Informe 1 (`summary`, `highlights`, `keyMoments`): sin CV.
- Informe 2 (`executiveSummary`, `strengths`, `weaknesses`): sin CV — de hecho el Informe 2 señala como debilidad *"No se exploró a fondo el conocimiento en Playwright"*, ignorando que el CV menciona React/Cypress explícitamente.

**Diagnóstico (no corregido en este pase, es hallazgo):** el texto del CV llega al prompt (`cvSection` se concatena al mensaje `user` en `firstQuestion` y `buildEvaluatePrompt`), pero **ninguna instrucción del `LEIA_SYSTEM_PROMPT` ni de la sección de reglas le dice al modelo que debe usar/citar el CV**. El modelo simplemente no le da prioridad a un bloque de texto sin instrucción explícita sobre qué hacer con él. La corrección probable es agregar una regla explícita al system prompt (ej. "si hay CV disponible, buscá referenciar al menos un dato concreto en los primeros turnos") — es una decisión de contenido de prompt, no de código, así que queda para el Arquitecto.

---

## 6. Verificación Final

| Verificación | Comando | Resultado |
|---|---|---|
| Build backend | `npm run build --workspace=backend` | OK (exit 0) |
| Build frontend | `npm run build --workspace=frontend` | OK (exit 0) |
| Suite | `cd backend && npx vitest run` | 38/38 PASS (6 archivos) |
| Soak AC-NEW-04 | ver §5 | Evidencia positiva parcial + punto abierto documentado |
| Verificación AC-NEW-06 | ver §5 | Hallazgo negativo confirmado (2/2 corridas) |
| Regresión (implícita) | Todas las entrevistas creadas durante T05 completaron su ciclo normal (turnos, evaluaciones, 2 informes) sin romperse | OK — el mecanismo de fallback y el resto del arnés no se vieron afectados por los cambios de este ticket |

---

## 7. Archivos Tocados

- **Modificados:**
  - `backend/src/services/voice/live-session.ts` — `sessionResumption`/`contextWindowCompression` en la config; captura de `sessionResumptionUpdate`/`goAway`; `openSession()`/`reconnect()`; política de reintentos (`shouldReconnect`, exportada).
  - `backend/src/services/voice/live-session.test.ts` — 5 tests nuevos de `shouldReconnect`.
  - `backend/src/services/leia/mock.ts` — `extractCvHighlight` (exportada) + `firstQuestion` cita contenido concreto del CV.
- **Creados:**
  - `backend/scripts/soak-live-session.ts` — script de soak (no forma parte del build ni de la suite).
  - `backend/src/services/leia/mock.test.ts` — 6 tests (`extractCvHighlight` + `firstQuestion` con/sin CV).
- **Fuera de las listas del plan:** ninguno.

---

## 8. Hallazgos Fuera de Alcance

- **Crash del backend por error de red no capturado en `msedge-tts`:** `Error: Edge TTS WebSocket error: (code=ETIMEDOUT)` tira una excepción no atrapada que mata el proceso Node completo (visto en `backend/src/services/tts/edge.ts:74` durante `InterviewEngine.start()`). Es un problema de robustez preexistente (no introducido por este ticket): un timeout de red transitorio no debería poder derribar todo el backend. Gestión sugerida: envolver la síntesis de Edge TTS (y sus llamadas internas del WS) en un try/catch que la trate como cualquier otro fallo de proveedor dentro de la cadena de fallbacks existente, en vez de dejar que la excepción escape sin manejar.
- **Pérdida de estado en memoria de entrevistas `en_curso` ante un restart del backend:** confirmado en la práctica (interview `d0730a7c...` quedó con `simulateCandidateAnswer: bot no encontrado` tras el restart). Es arquitectura conocida y ya documentada en el Mapa del Sistema (engine/bus en memoria de proceso, gap CHG-INFER-06 del contrato de la Etapa 1) — no es hallazgo nuevo, se re-confirma con evidencia real de este ticket.

---

## 9. Pendientes y Próximos Pasos

- [ ] **Arquitecto:** decidir el ajuste de prompt para AC-NEW-06 (instrucción explícita en `LEIA_SYSTEM_PROMPT`/`buildEvaluatePrompt` para que el modelo referencie el CV) — nueva iteración, no parche del Ejecutor.
- [ ] **Opcional, si se quiere cerrar AC-NEW-04 con evidencia más limpia:** re-correr el soak sin gaps de reloj de pared, y/o extender el timeout del chequeo final post-reconexión (hoy 8s) a 15-20s.
- [ ] Ticket de robustez sugerido (fuera de este alcance): capturar el error de red de `msedge-tts` para que no tire abajo el proceso.
- [ ] Commit de este ticket en `feature/arnes-etapa-1-candidato`, esperando confirmación.

---

## CHANGELOG

- v1.0 (2026-07-09): Ejecución inicial. Grupo A (T01-T03) completado con evidencia real positiva parcial para AC-NEW-04. Grupo B: T04 completado; T05 confirma con evidencia real que AC-NEW-06 no se cumple con el prompt actual — hallazgo reportado al Arquitecto, no corregido en este pase.
