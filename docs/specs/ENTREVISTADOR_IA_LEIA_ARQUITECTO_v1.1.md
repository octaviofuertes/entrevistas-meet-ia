# Arnés del Agente Entrevistador leIA — Addendum v1.1: revisión de D1 tras el spike T06

> Este addendum se lee **junto con** `ENTREVISTADOR_IA_LEIA_ARQUITECTO_v1.0.md` (no lo reemplaza). Cubre únicamente la reconsideración de la decisión D1 a la luz de la evidencia real del spike T06, ya ejecutado y validado (`ENTREVISTADOR_IA_LEIA_EJECUCION_v1.0.md`). El resto del análisis v1.0 (validación del contrato, gaps, riesgos R02-R10, estimación de Etapas 0-3) sigue vigente sin cambios.

## 0. Metadatos del Addendum

- **Versión:** v1.1 (refinamiento — D1 no se revierte, se sostiene condicionalmente a un segundo spike acotado)
- **Fecha:** 2026-07-06
- **Motivo:** el desarrollador pidió explícitamente frenar antes de planificar la Etapa 1 hasta que el Arquitecto revise `SPIKE_LIVE_API_RESULTADOS_v1.0.md`.
- **Base de código:** sin cambios respecto a v1.0 (`feature/arnes-etapa-0-saneo`, nada commiteado todavía).

---

## 1. Qué cambió: los 3 hallazgos del spike contra D1

D1 (v1.0, §7.1) tiene tres afirmaciones independientes. El spike las pone a prueba por separado:

| Afirmación de D1 | Evidencia del spike | Veredicto |
|---|---|---|
| (a) El arnés se engancha por **transcripciones** (entrada/salida) para reconstruir turnos | Salida: 5/5 corridas, calidad alta y consistente. Entrada: parcial/incompleta, pero **con una causa identificada y no descartada** (audio enviado en burst, no paceado a tiempo real — limitación del spike, no necesariamente del API) | **Sostenida, con una verificación pendiente** |
| (b) Live API aporta **barge-in nativo** | No se detectó `interrupted` ni con texto (`sendClientContent`, que el propio SDK documenta como no apto para esto) ni con audio real vía `sendRealtimeInput` — pero el segundo intento también sufrió el problema de burst-send, y además el turno pudo haber terminado antes de que llegara la interrupción (respuesta corta pese al pedido de "ocho oraciones") | **No confirmada, no refutada — inconclusa** |
| (c) El arnés **dirige** (guards, susurro, cierre) por **inyección de contexto** | Probado con un turno de texto embebiendo la instrucción: el modelo la absorbió como parte de la conversación, no como directiva del entrevistador. La palabra clave objetivo ("Playwright") no apareció | **Refutada — el mecanismo probado no funciona** |

A esto se suma un hallazgo no anticipado: **latencia real ~4.7s** (vs. objetivo 1.5s), con causa plausible identificada (el modelo emite bloques de "thinking" en texto antes de generar audio, igual que el Gemini de texto regular — que en `services/leia/gemini.ts` ya se neutraliza con `thinkingConfig.thinkingBudget=0`).

**Lectura del Arquitecto:** D1 no está refutada en su núcleo (transcripción como enganche sigue siendo el mecanismo correcto y es lo único confirmado con alta confianza), pero **dos de sus tres patas de ejecución fallaron con el mecanismo específico que asumí en v1.0** — no con el concepto en sí. La diferencia importa: "sendClientContent con texto embebido no dirige al modelo" es un hallazgo sobre una implementación concreta, no una prueba de que "Live API no se puede dirigir".

---

## 2. Por qué no recomiendo abandonar D1 todavía (ni tampoco darla por buena)

Descarté dos extremos:

- **"D1 se sostiene tal cual, seguimos":** no es responsable — el steering probado falló con evidencia clara, y planificar la Etapa 1 (susurro del reclutador, guards anti-repetición, cierre por pisos/techos — todos dependen de "dirigir" la sesión Live) sobre un mecanismo ya refutado es exactamente el error que este rol existe para prevenir.
- **"D1 se abandona, pasamos a Plan B (pipeline por piezas) como primario":** tampoco está justificado todavía — el núcleo de Live API (conexión, audio bidireccional, transcripción de salida, voces en español con voseo real) funciona bien y es el diferencial de la propuesta original. Descartarlo ahora tira ese valor sin haber agotado alternativas baratas y ya identificadas en el propio SDK.

**Encontré dos alternativas concretas y no probadas, disponibles en el SDK que ya está instalado** (verificado en `node_modules/@google/genai/dist/genai.d.ts`, no es especulación):

1. `LiveConnectConfig.thinkingConfig` existe (línea 8306 del `.d.ts`) — el mismo campo que ya usa `services/leia/gemini.ts` para el driver de texto. Nunca se probó desactivarlo en el spike. Candidato directo para atacar el hallazgo de latencia (~4.7s).
2. `LiveConnectConfig.tools` existe (línea 8318) — function-calling real del Live API. En vez de "susurrar" con un turno de texto embebido (lo que falló), el arnés podría exponer una **tool** tipo `incorporar_sugerencia_reclutador(texto)` que el modelo invoque o que el backend fuerce vía `LiveClientToolResponse` — un mecanismo de dirección explícito por protocolo, no una convención de texto que el modelo puede ignorar.

Ninguna de las dos requiere volver a especificar el contrato ni cambiar el contrato de Cambios Propuestos — son detalles de implementación del mismo Outcome B/E del contrato (barge-in, susurro).

---

## 3. Recomendación: Spike 2, acotado y corto (no un re-spike completo)

Propongo un **segundo spike, mucho más chico que T06** (script ya existe, son ajustes puntuales, estimado en 1-2 horas, no un día), con 3 pruebas puntuales:

1. **Latencia con `thinkingConfig.thinkingBudget=0`:** repetir el Test A del spike con ese campo seteado. Si baja de ~4.7s a un rango razonable (<2s), es una victoria rápida y de bajo riesgo.
2. **Steering vía `tools`:** definir una tool mínima (`incorporar_sugerencia`) en la config y probar si el modelo la invoca al recibir un turno de texto que la amerite, o si el backend puede forzar su ejecución. Si funciona, D1(c) queda confirmada con un mecanismo distinto al descartado.
3. **Barge-in con audio realmente paceado:** reenviar el Test B/C pero con un `setInterval` que libere los chunks PCM al ritmo real de reproducción (no en burst), simulando mejor un micrófono real. Esto resuelve la ambigüedad metodológica del spike 1 para AMBOS pendientes (transcripción de entrada Y barge-in) con el mismo fix.

**Criterio de decisión tras el Spike 2:**
- Si **2 de 3** mejoran → D1 se sostiene, ajustada con estos mecanismos concretos (nueva sub-decisión D1', documentada al planificar la Etapa 1).
- Si **≤1 de 3** mejora → recomiendo pivotar: Plan B (pipeline STT/TTS por piezas + barge-in manual del lado cliente) pasa a ser el **camino primario** de la Etapa 1, y Live API queda como mejora futura opcional (exactamente la inversión de prioridad que la propia `INVESTIGACION_ECOSISTEMA_GOOGLE_2026-07.md` ya había dejado como plan B disponible).

En cualquier caso, el contrato (`CAMBIOS_PROPUESTOS_v1.0.md`) no necesita reabrirse: los Outcomes B/C/E del contrato (interrupciones, latencia, susurro) siguen siendo los mismos; lo que cambia es el mecanismo de implementación, que es prerrogativa del Arquitecto, no del Elicitador.

---

## 4. Actualización de riesgos (respecto a v1.0 §5)

| ID | Riesgo (v1.0) | Estado tras T06 |
|---|---|---|
| R01 | Live API en Preview, sin SLA | **Confirmado parcialmente**: conecta y funciona, pero el modelo real (`gemini-2.5-flash-native-audio-latest`) difiere del documentado públicamente (`gemini-live-2.5-flash-preview`) — mayor volatilidad de la esperada. Mitigación original (fallback) sigue válida. |
| R02 | Límites de sesión (15/10 min) | Sin cambio — no se probó con sesión larga real (fuera del timebox de T06). Sigue abierto para cuando se implemente Etapa 1. |
| R04 | Calidad de voz insuficiente | **Mejor de lo esperado**: las 3 voces probadas (Puck/Kore/Aoede) devuelven voseo rioplatense natural por transcripción. Falta validación por oído humano antes de fijar default. |
| **R11 (nuevo)** | Steering vía texto embebido no dirige al modelo | Alta — bloquea el susurro del reclutador y los guards del engine tal como estaban planeados en D1. Mitigación: Spike 2, prueba 2 (`tools`). |
| **R12 (nuevo)** | Latencia real ~3× el objetivo | Alta para la experiencia "wow" del candidato. Mitigación: Spike 2, prueba 1 (`thinkingConfig`). |

---

## 5. Decisión del desarrollador (2026-07-06)

**Confirmado: Spike 2 acotado.** Se ejecuta antes de generar el Plan Ejecutor de la Etapa 1.

## 6. Especificación de la tarea — Spike 2 (para el Agente Ejecutor)

- **Base:** `backend/scripts/spike-live-api.ts` (ya existe, de T06). Se extiende, no se reescribe.
- **Guardarraíles:** mismos que T06 — no tocar nada fuera de `backend/scripts/`; no commitear sin confirmación; requiere `GEMINI_API_KEY` de tier pago ya presente en `.env`/`backend/.env`.
- **Timebox:** 1-2 horas. Si algo no se resuelve en ese margen, se registra "no verificado" y se corta — no extender sin nueva decisión del desarrollador.

### Prueba 1 — Latencia con thinking desactivado
- **Qué hacer:** agregar `thinkingConfig: { thinkingBudget: 0 }` a la config de `connectSession()` (o a una variante de prueba separada) y repetir el Test A (medir tiempo entre `sendClientContent` y primer chunk de audio).
- **Criterio de éxito:** latencia baja de forma significativa respecto a los ~4.6-4.9s medidos en el spike 1 (objetivo de referencia: <2s).
- **Si el campo no es válido para el Live API** (el servidor cierra la sesión con error, como pasó con `proactivity` en T06): registrar el error exacto y marcar "no soportado" — no es un fallo del spike, es información.

### Prueba 2 — Steering vía `tools` (function-calling)
- **Qué hacer:** definir en la config una tool mínima, p. ej. `{ functionDeclarations: [{ name: 'incorporar_sugerencia_reclutador', description: 'Usar cuando el entrevistador humano sugiere un tema a indagar', parameters: { type: 'OBJECT', properties: { tema: { type: 'STRING' } } } }] }`. Enviar un turno de candidato normal, luego un mensaje simulando al reclutador que debería disparar la tool (o forzar la ejecución vía `LiveClientToolResponse` si el modelo no la invoca solo), y verificar en la siguiente respuesta si el tema sugerido aparece.
- **Criterio de éxito:** el tema sugerido aparece en la transcripción de salida del turno siguiente.

### Prueba 3 — Barge-in y transcripción de entrada con audio paceado a tiempo real
- **Qué hacer:** modificar el envío de audio (tanto en el Test C de entrada como en el Test B de interrupción) para liberar los chunks PCM con un `setInterval`/`setTimeout` que respete la duración real del audio (16kHz, 16-bit mono → 32000 bytes/segundo; pacear los chunks de 4096 bytes cada ~128ms), en vez del loop síncrono actual.
- **Criterio de éxito (transcripción):** el texto reconocido de entrada coincide sustancialmente con el texto sintetizado original (a diferencia del resultado parcial del spike 1).
- **Criterio de éxito (barge-in):** aparece `serverContent.interrupted: true` en algún mensaje posterior al envío del audio de interrupción, con audio nuevo del modelo cortando al anterior.

### Entregable
Actualizar `docs/specs/SPIKE_LIVE_API_RESULTADOS_v1.0.md` → **v1.1** (no crear un archivo nuevo): agregar una sección "Spike 2 — resultados" con la misma evidencia cruda (JSON/transcripciones) que el spike 1, y un veredicto final sobre D1 según el criterio de decisión de la sección 3 de este addendum (2/3 mejoran → D1 ajustada; ≤1/3 → pivot a Plan B). Actualizar también el CHANGELOG de ese archivo.

### Siguiente paso tras el Spike 2
Con el resultado, el Arquitecto retoma (este mismo addendum pasa a v1.2 o se cierra) para: (a) si D1 se sostiene, generar el Plan Ejecutor de la Etapa 1 con los mecanismos confirmados; (b) si pivota a Plan B, replantear el diseño de la Etapa 1 alrededor del pipeline por piezas antes de planificar.

---

## CHANGELOG

- v1.1 (2026-07-06): Addendum a v1.0 tras el spike T06. D1 no se revierte pero queda condicionada a un segundo spike acotado (3 pruebas: thinkingConfig, tools/function-calling, audio paceado). Confirmado por el desarrollador: ejecutar Spike 2. Riesgos nuevos: R11 (steering no confirmado), R12 (latencia 3x objetivo). Riesgos actualizados: R01, R02, R04.
