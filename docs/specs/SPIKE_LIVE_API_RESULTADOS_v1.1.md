# Spike T06 — Gemini Live API como voz primaria de la sala nativa

> **v1.1 — Veredicto final:** D1 sostenida y ajustada (D1'), ver §"Veredicto final" al pie. El Spike 1 (§Resumen ejecutivo / Resultados por criterio) dejó 3 hallazgos abiertos; el Spike 2 los resolvió 2 de 3 a favor. El contenido del Spike 1 queda intacto abajo como evidencia histórica.

- **Fecha:** 2026-07-06
- **Alcance:** Etapa 0 del plan (`ENTREVISTADOR_IA_LEIA_PLAN_EJECUTOR_v1.0.md`, T06), compuerta go/no-go para la Etapa 1.
- **API key usada:** tier pago provisto por el desarrollador, cargado en `.env`/`backend/.env` (no committeado).
- **SDK:** `@google/genai@2.10.0` (instalado como devDependency, autorizado por el plan).
- **Script:** `backend/scripts/spike-live-api.ts` (sonda manual, no forma parte de la suite de tests).
- **Modelo real disponible para esta key:** la lista de modelos (`GET /v1beta/models`) mostró **un único modelo con `bidiGenerateContent`**: `gemini-2.5-flash-native-audio-latest`. El nombre `gemini-live-2.5-flash-preview` (usado en varios ejemplos de la documentación pública) **no está disponible para esta cuenta** — la conexión se abre pero el servidor la cierra inmediatamente (código 1008, "model not found... or not supported for bidiGenerateContent"). **Todo lo que sigue usa `gemini-2.5-flash-native-audio-latest`.**

## Resumen ejecutivo (Spike 1)

| Criterio | Resultado | Confianza |
|---|---|---|
| 1. Conexión y conversación | ✅ Funciona | Alta |
| 2. Transcripciones (salida) | ✅ Funciona bien | Alta |
| 2. Transcripciones (entrada) | ⚠️ Parcial/incompleta en esta prueba | Baja — ver limitación metodológica |
| 3. Barge-in | ❓ No concluyente en este spike | Baja — ver limitación metodológica |
| 4. Sesión larga (resumption) | ⚠️ No se recibió handle en sesiones cortas | Media |
| 5. Voces en español | ✅ Las 3 voces probadas suenan rioplatenses | Alta (evidencia textual; falta oído humano) |
| 6. Latencia | ⚠️ ~4.6–4.9s al primer audio (objetivo era ≤1.5s) | Alta |
| 7. Steering (mid-session) | ❌ No se incorporó la instrucción inyectada vía `sendClientContent` | Alta |
| 8. Costo | ⚠️ No se recibió `usageMetadata` en las sesiones cortas | Baja |

**Veredicto del Spike 1: GO CON RESERVAS.** El núcleo (conexión, audio bidireccional, transcripción de salida, voces en español) funciona y es utilizable. Pero **tres hallazgos cambian el diseño de la Etapa 1** (ver Recomendaciones): la latencia real es ~3× peor que el objetivo, el mecanismo de steering asumido en la decisión D1 del Arquitecto no funciona como se planeó, y el modelo disponible es distinto al documentado públicamente (afecta cualquier referencia a "Live API" en otros documentos del proyecto).

## Limitación metodológica transversal (leer antes de los resultados de C y B)

Para los tests de audio de entrada (C) y de interrupción (B) sinteticé el audio con Edge TTS y lo mandé **en un solo burst síncrono** (todos los chunks PCM en un loop cerrado), no paceado en tiempo real como llegaría de un micrófono real. Es probable que esto sea la causa de que la transcripción de entrada salga incompleta y de que la interrupción no se detecte — el pipeline de VAD/STT del Live API espera audio que llega a ritmo real, no un volcado instantáneo. **No pude, dentro del timebox, reescribir el envío con pacing real** (requeriría un `setInterval` sincronizado a la duración real de cada chunk). Esto se registra como limitación, no como conclusión de que la función no existe — ver Recomendaciones.

## Resultados por criterio (con evidencia)

### 1. Conexión y conversación — ✅
Conecta, `setupComplete` llega, el modelo responde con audio real (`audio/pcm;rate=24000`) a un turno de texto. Confirmado en 3 corridas independientes sin errores.

### 2. Transcripciones
- **Salida:** consistente y de buena calidad en las 5 corridas. Ejemplos textuales reales devueltos por el modelo:
  - *"¡Hola Ana! Soy LeIA, tu entrevistadora virtual, y vamos a simular una entrevista de prueba para un puesto clave."*
  - *"¡Hola Ana! Yo soy LeIA, tu entrevistadora virtual, y estoy acá para que simulemos una entrevista de prueba y practiquemos juntos."*
- **Entrada:** con el audio original *"Tengo experiencia con React, Node y bases de datos PostgreSQL desde hace tres años"* obtuve *" Tengo experiencia con, no y bases de datos post"* — reconoce el arranque y la cola, pierde "React" y trunca "PostgreSQL". Ver limitación metodológica arriba. **No se puede confirmar ni descartar la calidad real de este sub-criterio con esta evidencia.**

### 3. Barge-in — no concluyente
Probé dos mecanismos:
- `sendClientContent` con un segundo turno de texto mientras el modelo generaba: el propio SDK documenta que este método **no está optimizado para interrupciones** (agrega al contexto "en orden", a diferencia de `sendRealtimeInput`). No detectó `interrupted`.
- `sendRealtimeInput` con audio real (sintetizado) enviado apenas llegó el primer chunk de audio del modelo: tampoco se detectó `interrupted`, y no llegaron más chunks de audio después (compatible con que el modelo ya había terminado de hablar para esa respuesta corta, o con el burst-send no siendo reconocido como "el usuario está hablando ahora").

**No se pudo confirmar el barge-in en este spike.** Es el hallazgo de mayor impacto en el diseño — ver Recomendaciones.

### 4. Sesión larga — mecanismo presente, no cargado
`sessionResumption: {}` se aceptó en la config (no dio error), pero en sesiones de pocos segundos el servidor no llegó a mandar `sessionResumptionUpdate`. Es esperable — ese evento se emite en puntos de checkpoint, no inmediatamente. **No se validó con una sesión de 15-20 minutos reales** (fuera del timebox). El mecanismo existe en el protocolo (confirmado por los tipos del SDK y por la ausencia de error al configurarlo), pero su comportamiento a los 15+ minutos reales queda sin verificar.

### 5. Voces en español — ✅
Probé `Puck`, `Kore`, `Aoede` (con `languageCode: 'es-US'`). Las tres respondieron con audio y transcripciones con voseo rioplatense natural:
- Puck: *"¡Hola! Ando con mucha curiosidad y energía hoy, ¿y vos cómo estás?"*
- Kore: *"¡Hola! Estoy re bien, con ganas de empezar esta charla, ¿vos?"*
- Aoede: *"¡Hola! Todo genial por acá, con muchas ganas de empezar y ver qué onda."*

Ninguna dio error. **Falta la validación subjetiva por oído humano** (esto solo confirma que el texto reconocido tiene voseo correcto, no cómo "suena" el acento — recomendado antes de elegir la voz de producción).

### 6. Latencia — ⚠️ peor que el objetivo
Medido como tiempo entre `sendClientContent` y el primer chunk de audio recibido: **4624–4851 ms** en 2 corridas. El objetivo de la propuesta era p50 ≤ 1.500 ms. Nota: el modelo emite bloques de "thinking" (texto interno, ver hallazgo below) antes del audio, lo que probablemente explica buena parte de esa demora.

### 7. Steering — ❌ no funcionó como se probó
Inyecté una instrucción intercalada como si fuera un turno más: *"[Instrucción interna del entrevistador, no la leas en voz alta...]: preguntale específicamente por Playwright."* El modelo respondió coherentemente al hilo de la conversación (testing automatizado) pero **no incorporó "Playwright"** ni cambió de rol a "hacer la siguiente pregunta" — lo tomó como parte del turno del usuario. La decisión de diseño D1 del Arquitecto ("dirigir por inyección de contexto") **no está confirmada con este mecanismo**; probablemente necesite usar `systemInstruction` actualizado o un mensaje explícitamente marcado por rol, no un turno de usuario con una instrucción embebida en el texto.

### 8. Costo — sin datos
`usageMetadata` no llegó en ninguna de las sesiones cortas (puede emitirse solo al final de sesiones más largas o al cierre formal). **No se pudo estimar el costo real por esta vía dentro del timebox.**

## Hallazgo adicional no listado en los 8 criterios

El modelo devuelve bloques de **"thinking" en texto plano** (`{"text": "...", "thought": true}`) antes de generar audio — visible en el debug crudo. Esto consume tiempo (contribuye a la latencia del punto 6) y tokens de salida. A diferencia del texto normal de Gemini (donde `thinkingConfig.thinkingBudget=0` lo desactiva, patrón ya usado en `services/leia/gemini.ts`), **no verifiqué si el Live API respeta el mismo campo** — pendiente para la Etapa 1.

## Recomendación para el Arquitecto / Etapa 1 (Spike 1)

1. **Barge-in: repetir la prueba con audio paceado en tiempo real** (no burst) antes de comprometerse al diseño D1 tal cual está. Si sigue sin confirmarse, el plan B (pipeline STT/TTS por piezas + barge-in manual del lado cliente cortando el `<audio>`) pasa de "fallback" a **camino primario**, y Live API se reevalúa más adelante.
2. **Steering: no asumir que un turno de texto embebido dirige al modelo.** Probar como alternativa (a) actualizar `systemInstruction` a mitad de sesión si el SDK lo permite, o (b) usar el mecanismo de `tools`/function-calling del Live API para que el "susurro" sea una llamada a herramienta explícita en vez de texto libre.
3. **Latencia (~4.7s) es alta para el objetivo de demo.** Antes de la Etapa 1, probar si desactivar el "thinking" (si el Live API expone un campo equivalente a `thinkingConfig.thinkingBudget=0`) baja la latencia significativamente.
4. **Modelo real a usar:** `gemini-2.5-flash-native-audio-latest`, no `gemini-live-2.5-flash-preview` (el de los ejemplos públicos) — actualizar cualquier referencia futura en el código/documentación.
5. **Sesión larga y costo:** quedan sin validar con carga real; antes de producción, correr una sesión de 20 minutos real y revisar el `usageMetadata` acumulado.
6. **Voces:** validar Puck/Kore/Aoede escuchándolas (no solo por transcripción) antes de fijar la default de producto.

## Cómo re-ejecutar

```bash
cd backend
npx tsx scripts/spike-live-api.ts
```

Requiere `GEMINI_API_KEY` (tier pago) en `.env`/`backend/.env` y `ffmpeg` en el PATH.

---

# Spike 2 (2026-07-06) — 3 pruebas puntuales, veredicto final sobre D1

- **Origen:** `ENTREVISTADOR_IA_LEIA_ARQUITECTO_v1.1.md` §3, tras revisar los hallazgos del Spike 1.
- **Timebox:** 1-2 horas (cumplido).
- **Script:** mismo `backend/scripts/spike-live-api.ts`, con 3 tests nuevos agregados al final (F, G, H1, H2).
- **Criterio de decisión pre-acordado con el Arquitecto:** si ≥2 de 3 pruebas mejoran → D1 se sostiene, ajustada. Si ≤1 de 3 → pivotar a Plan B (pipeline por piezas) como camino primario.

## Resultado de las 3 pruebas

| # | Prueba | Resultado | Evidencia |
|---|---|---|---|
| 1 | Latencia con `thinkingConfig.thinkingBudget=0` | ✅ **Mejora confirmada** | Latencia al primer audio: **1296 ms** (vs. 4342-4851 ms del Spike 1 sin este flag). `vioBloqueDeThinking: false` confirma que el flag efectivamente desactiva el "thinking". Dentro del objetivo (≤1500 ms). |
| 2 | Steering vía `tools`/function-calling | ❌ **Sigue sin funcionar** | Config con `tools: [{functionDeclarations: [incorporar_sugerencia_reclutador]}]` y `systemInstruction` explícita indicando cuándo invocarla. El modelo **no invocó la herramienta** (`invocóLaHerramienta: false`) ni incorporó la palabra clave ("Playwright") en su respuesta, a pesar del prefijo `SUGERENCIA_RECLUTADOR:` diseñado para dispararla. |
| 3 | Barge-in con audio **paceado a tiempo real** (no burst) | ✅ **Mejora confirmada** | `detectóInterrupcion: true`, latencia de detección **621 ms**. Confirma que el problema del Spike 1 era metodológico (burst-send), no una limitación real del API — con pacing correcto, el barge-in nativo funciona. |

**2 de 3 mejoraron → según el criterio pre-acordado, D1 se sostiene, ajustada.**

## Hallazgo adicional no anticipado (Test H1)

Repetí la transcripción de entrada con el mismo audio de prueba, ahora **paceado** igual que en el Test H2. **No mejoró**: *"Tengo experiencia con, no y bases de datos posteriores se huele desde hace 3 años"* (pierde "React", transforma "PostgreSQL" en algo irreconocible). Esto descarta el pacing como causa única — la causa real queda sin identificar (candidatos: pronunciación de términos técnicos en inglés por parte del Edge TTS usado para sintetizar el audio de prueba, o una limitación real del modelo de transcripción de Gemini Live con jerga técnica mixta español/inglés). **No se puede seguir usando el mismo texto de prueba para descartar esto — requeriría audio de una voz humana real, fuera del alcance de un spike.**

## Veredicto final: D1 sostenida y ajustada (D1')

La decisión de diseño D1 ("el modelo conversa, el arnés supervisa") **se mantiene** para la Etapa 1, con estos ajustes concretos que pasan a ser parte de la especificación de implementación:

1. **Toda sesión Live de producción debe setear `thinkingConfig: { thinkingBudget: 0 }`** — sin esto, la latencia (~4.7s) es inaceptable para la experiencia de demo.
2. **El barge-in se implementa enviando el audio del candidato por `sendRealtimeInput` paceado a su duración real** (streaming genuino, no un buffer completo de una sola vez) — el mismo patrón que ya usaría cualquier integración real con un micrófono (no es un cambio de diseño, es una confirmación de que el patrón obvio funciona).
3. **El susurro del reclutador NO se implementa vía `tools`/function-calling de Live API** — ese mecanismo específico está descartado por evidencia. Alternativas a evaluar en el diseño de la Etapa 1 (no bloqueante para arrancar): (a) el arnés corta la sesión Live del turno actual y la reabre con un `systemInstruction` actualizado que incluya la sugerencia — más disruptivo pero garantizado; (b) el arnés inyecta la sugerencia como parte del `system_instruction` inicial de cada nueva pregunta si el SDK permite actualizarlo sin reconectar (sin verificar); (c) aceptar que el susurro solo se soporta en el canal Meet (pipeline por piezas, donde sí es un simple string en el prompt de `leia.evaluate()`) y no en la sala nativa con Live API en la primera versión.
4. **Riesgo abierto, no bloqueante:** la transcripción de entrada puede perder términos técnicos específicos. La evaluación de leIA no debería depender 100% de la transcripción de Live para detectar menciones de stack — considerar mantener la evaluación de texto (`leia.evaluate()`) como la fuente de verdad principal (ya es así en D1), y tratar la transcripción de Live únicamente como el mecanismo de reconstrucción de turnos, no de análisis fino de contenido.
5. **Modelo a usar:** `gemini-2.5-flash-native-audio-latest` (confirmado, no el de la documentación pública).

**Esto desbloquea la planificación de la Etapa 1** con el Arquitecto, incorporando estos 5 puntos como parte del diseño de `VoiceSession`/`live-session.ts` (§3.2 del `ARQUITECTO_v1.0.md`).

## CHANGELOG

- v1.0 (2026-07-06): Spike 1. Veredicto GO CON RESERVAS — 3 hallazgos abiertos (latencia, steering, barge-in inconcluso).
- v1.1 (2026-07-06): Spike 2 (3 pruebas puntuales). Veredicto final: D1 sostenida y ajustada (D1'). Latencia y barge-in resueltos; steering vía tools descartado (requiere mecanismo alternativo); nuevo hallazgo sobre transcripción de términos técnicos.
