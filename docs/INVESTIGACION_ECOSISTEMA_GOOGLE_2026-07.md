# ¿Alcanza el ecosistema Google? — Investigación de proveedores (julio 2026)

- **Fecha:** 2026-07-06 (investigación web sobre pricing y docs oficiales vigentes)
- **Complementa a:** `PROPUESTA_ARNES_AGENTE_ENTREVISTADOR_v1.0.md` (resuelve la decisión abierta §7.1 y §7.2)
- **Pregunta:** para el arnés del agente entrevistador, ¿el ecosistema Google cubre todas las piezas o necesitamos otros proveedores?

## Veredicto ejecutivo

**Google cubre ~80 % del arnés — y la pieza estrella (voz conversacional con barge-in nativo) la resuelve mejor y más rápido que armarla con piezas sueltas.** Pero hay dos huecos que Google NO cubre y exigen terceros, y un riesgo transversal (mucho de lo bueno de Google está en *Preview*, sin SLA).

| Pieza del arnés | ¿Google la tiene? | Estado | Recomendación |
|---|---|---|---|
| Cerebro (evaluar/preguntar/informes) | ✅ Gemini 3.5 Flash / 3.1 Flash-Lite | GA | **Google** (Claude queda como driver alternativo — tesis del cerebro intercambiable) |
| Voz conversacional realtime + barge-in | ✅ **Gemini 3.1 Flash Live** (Live API) | ⚠️ Preview | **Google** para la sala nativa (con mitigaciones, ver abajo) |
| STT streaming suelto | ✅ Cloud STT Chirp 3 ($0.016/min) | GA | Google como default GA; **Deepgram Nova-3 ($0.0077/min) opcional** por mitad de costo |
| TTS suelto | ✅ Gemini TTS (preview) / Cloud TTS Chirp 3 HD | Mixto | Google; ElevenLabs solo si se busca "voz marca premium" (es más caro) |
| Bot dentro de Google Meet | ❌ **Meet Media API: solo consumo, Developer Preview, requisitos inviables** | — | **Recall.ai sigue siendo obligatorio** para el canal Meet |
| Avatar interactivo foto-realista | ❌ No existe producto Google | — | **HeyGen LiveAvatar / Simli** (tier premium); el avatar audio-reactivo propio sigue siendo el default gratis |

## Hallazgos por pieza

### 1. Gemini Live API — la sorpresa positiva (cambia la recomendación de la propuesta)

Google lanzó en marzo 2026 **Gemini 3.1 Flash Live**, un modelo realtime multimodal específicamente orientado a agentes de voz, con:
- **Barge-in nativo y robusto** (interrupciones a mitad de frase, incluso en ambientes ruidosos) y "proactive audio" (decide cuándo responder y cuándo callar) — es decir, **el momento wow #1 de nuestra demo viene de fábrica**.
- Conexión bidireccional por WebSocket; al interrumpir, descarta el buffer de audio y procesa lo nuevo — exactamente el estado `interrupted` que íbamos a construir a mano.
- **Precio audio: ~$0.005/min entrada, ~$0.018/min salida.** Para una entrevista de 20 min (leIA habla ~8 min): ≈ **USD 0.25–0.40 todo incluido** (oído + cerebro + voz). Dentro de la banda "clase media".

**Riesgos y mitigaciones (por qué el arnés sigue siendo nuestro):**
- **Preview, sin SLA.** Mitigación: la cadena de fallback existente (pipeline por piezas → Edge TTS/mock) se mantiene como está.
- **Límites de sesión:** ~15 min de audio sin compresión de contexto y ~10 min por conexión → una entrevista de 20 min **requiere implementar session resumption + context window compression** (documentado y soportado, pero es trabajo del arnés).
- **Acoplamiento:** se integra como un driver más detrás de nuestros contratos (`LeiaService`/`TTSService`), nunca como reemplazo de la abstracción.

### 2. STT y TTS por piezas (el plan B GA de Google)

- **Cloud STT Chirp 3:** GA, streaming, $0.016/min, 125+ idiomas → ~USD 0.19–0.32 por entrevista. Funciona hoy sin preview.
- **Cloud TTS Chirp 3 HD:** GA, streaming, ~USD 0.11 por entrevista (~7.000 caracteres). Gemini TTS (el que ya usamos) sigue en preview: 2.5 Flash TTS ≈ $0.12/entrevista, 3.1 Flash TTS ≈ $0.24.
- **Terceros:** Deepgram Nova-3 streaming $0.0077/min (≈ mitad que Google, ≈ USD 0.09/entrevista). ElevenLabs Flash ≈ $0.05/1.000 caracteres → ≈ USD 0.35/entrevista: **más caro que Google TTS**, solo se justifica por calidad/branding de voz.
- Conclusión: **con Google alcanza y sobra en costo**; Deepgram es optimización, ElevenLabs es gusto premium.

### 3. Google Meet — el hueco confirmado

El **Meet Media API** (la esperanza de reemplazar a Recall.ai) queda descartado para 2026:
- Sigue en **Developer Preview** (docs actualizadas abril 2026).
- Es **solo consumo** de streams: no permite inyectar el audio de leIA a la reunión (nuestro bot necesita hablar).
- Requisitos inviables para SaaS: proyecto, OAuth y **todos los participantes** enrolados en el Developer Preview, con consentimiento del organizador presente.

→ **Recall.ai se queda como proveedor del canal Meet** (≈ USD 0.20/entrevista), tal como está implementado. Re-evaluar Media API cuando pase a GA con salida de audio.

### 4. Avatar — Google no juega

No existe producto Google de avatar interactivo en tiempo real. Para el tier premium:
- **HeyGen LiveAvatar:** ~USD 0.10/min (Lite) a 0.20/min (Full) → USD 2–4 por entrevista de 20 min. Sesiones de hasta 20-60 min según plan. Confirma la banda estimada en la propuesta.
- **Simli** u otros (Anam, LiveAvatar.com): cotizar en la etapa correspondiente.
- El **avatar audio-reactivo propio (gratis)** sigue siendo el default del tier estándar.

## Impacto en la propuesta (actualización de la decisión §7.1-7.2)

La propuesta v1.0 recomendaba "pipeline desacoplado en v1; Live API como experimental después". **Con los datos de julio 2026 esto se invierte para la sala nativa:**

1. **Sala nativa (primera clase): Gemini Live API (3.1 Flash Live) como driver primario de voz.** Barge-in y latencia vienen resueltos → el wow del candidato llega en días, no semanas. Trabajo nuestro: session resumption (>15 min), integración al `InterviewEngine` como driver, y el prompt/rúbrica de leIA sobre el canal Live.
2. **Pipeline por piezas (Chirp 3 STT + TTS) como fallback GA** detrás del mismo contrato — si Live API (preview) falla o cambia, la entrevista degrada, no se cae. La cadena Edge/mock actual queda al final.
3. **Canal Meet (clase ejecutiva): sin cambios** — Recall.ai + el flujo actual. El audio que Recall reproduce puede venir de cualquiera de los TTS.
4. **Avatar premium: tercero (HeyGen/Simli), feature-flag**, igual que en la propuesta.

### Costos actualizados por entrevista de 20 min (tier estándar)

| Escenario | Composición | Costo aprox. |
|---|---|---|
| Sala nativa — Google Live API | 3.1 Flash Live (oído+cerebro+voz) + Flash-Lite (informes) | **≈ USD 0.30–0.40** |
| Sala nativa — piezas GA | Chirp 3 STT + Chirp 3 HD TTS + Flash-Lite | ≈ USD 0.35–0.50 |
| Meet | cualquiera de las anteriores + Recall.ai | + USD 0.20 |
| Premium avatar | + HeyGen LiveAvatar | + USD 2–4 ⚠️ |

## Respuesta directa a la pregunta

**Sí, el ecosistema Google tiene lo necesario para el núcleo del producto** (cerebro, oído, voz, barge-in, informes) a costo "clase media" y con la vía más corta al wow. **Necesitamos terceros exactamente en dos lugares:** Recall.ai para que leIA exista dentro de Google Meet (paradójicamente, Google no deja hablar a bots en su propio Meet), y HeyGen/Simli si se activa el avatar foto-realista premium. Deepgram/ElevenLabs quedan como optimizaciones opcionales, no como necesidades.

## Fuentes

- [Gemini API pricing (oficial)](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini Live API overview (oficial)](https://ai.google.dev/gemini-api/docs/live-api)
- [Session management / límites de sesión Live API (oficial)](https://ai.google.dev/gemini-api/docs/live-session)
- [Límites Live API (Firebase AI Logic)](https://firebase.google.com/docs/ai-logic/live-api/limits-and-specs)
- [Google releases Gemini 3.1 Flash Live (MarkTechPost, 26-mar-2026)](https://www.marktechpost.com/2026/03/26/google-releases-gemini-3-1-flash-live-a-real-time-multimodal-voice-model-for-low-latency-audio-video-and-tool-use-for-ai-agents/)
- [Meet Media API overview (oficial — Developer Preview, solo consumo)](https://developers.google.com/workspace/meet/media-api/guides/overview)
- [Cloud Speech-to-Text pricing (oficial)](https://cloud.google.com/speech-to-text/pricing)
- [Cloud Text-to-Speech pricing (oficial)](https://cloud.google.com/text-to-speech/pricing)
- [Deepgram pricing (oficial)](https://deepgram.com/pricing)
- [ElevenLabs API pricing (oficial)](https://elevenlabs.io/pricing/api)
- [HeyGen LiveAvatar (oficial)](https://help.heygen.com/en/articles/12758516-introducing-liveavatar)
- [HeyGen API pricing (oficial)](https://www.heygen.com/api-pricing)
