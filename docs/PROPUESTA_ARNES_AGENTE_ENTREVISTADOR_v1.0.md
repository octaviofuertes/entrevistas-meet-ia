# Propuesta: el Arnés del Agente Entrevistador (leIA) — de PoC a producto "wow"

- **Versión:** v1.0 — 2026-07-06
- **Autor:** análisis sobre el snapshot SDD `docs/specs/ENTREVISTADOR_IA_LEIA_ELICITADOR_MODO-D_v1.0.md` (base: `feature/sala-nativa @ fa9a386`)
- **Decisiones de encuadre del product owner (validadas en sesión):**
  1. Wow **primero para el candidato**, segundo para el reclutador (el reclutador es el cliente que paga; el candidato es el cliente del reclutador).
  2. **Sala nativa = primera clase** (vitrina del producto). **Meet+Recall = clase ejecutiva** (el piso: funciona donde todos trabajan).
  3. **Demo vendible impactante en días/pocas semanas.** La base de producto real ya existe; los puntos de integración quedan **previstos y comentados**, no construidos.
  4. Costos: **ni low-cost ni caro** — APIs competitivas con costo por entrevista que un cliente SaaS pueda pagar.

---

## 1. Tesis del producto

**El cerebro es un commodity; el arnés es el producto.**

Cualquier competidor puede llamar a Gemini o Claude con un prompt de entrevistador. Lo que no puede copiar en un fin de semana es el **cuerpo** que este repo ya tiene en embrión y que esta propuesta lleva a nivel demo-vendible:

| Órgano del agente | Ya existe (embrión) | Esta propuesta lo lleva a |
|---|---|---|
| **Voz** | TTS por entrevista (Gemini/Edge), sentence-streaming | Voz streaming de baja latencia con marca propia, tiers de calidad |
| **Oído** | Captions Recall / Web Speech + commit por silencio (700 ms) | Turnos naturales + **interrupciones (barge-in)** en sala nativa |
| **Presencia** | Avatar video mp4 idle/hablando en bot-stage | Avatar audio-reactivo con estados (escuchando/pensando/hablando) y opción premium lip-sync |
| **Ojos** | `useFaceAnalysis` + `BehavioralAnalysis` (desconectados) | Señales de atención/lectura conectadas al informe (anti-cheating ético) |
| **Sistema motor conversacional** | `InterviewEngine`: muletillas, anti-repetición, aclaraciones, pisos/techos, auto-finalización | + barge-in, + susurro del reclutador, + estados visibles |
| **Memoria/juicio** | Turnos + evaluaciones 6D + informes con analítica determinística | + informe compartible, + comparación entre candidatos (previsto) |
| **Canales** | `RecallService` con 3 implementaciones (mock/real/browser) | Contrato formalizado de canal: sala nativa primera clase, Meet clase ejecutiva, futuros (teléfono, Teams) enchufables |
| **Resiliencia** | Fallbacks en cadena (leIA→mock, GeminiTTS→Edge, output_audio→WS) | Igual filosofía sobre los proveedores nuevos |

El pitch de venta: *"leIA no es un chatbot con voz: es una entrevistadora con cuerpo, sentidos y criterio, que funciona en nuestra sala o en tu Google Meet, y que le deja al reclutador un informe que decide."*

---

## 2. El guion de la demo (el "wow" que vendemos)

Diseñar el producto desde la demo. Este es el recorrido de 10 minutos que debe dejar maravillado al reclutador:

1. **[Reclutador]** Crea el puesto pegando el link de su propia oferta de LinkedIn → leIA lo estructura sola. *(ya funciona)*
2. **[Reclutador]** Agenda la entrevista y copia el link de la sala. *(ya funciona en branch)*
3. **[Candidato]** Abre el link → **lobby profesional**: chequeo de cámara/mic, "leIA te va a entrevistar sobre el puesto X en Y, dura ~20 min", consentimiento de grabación/análisis. *(nuevo — Etapa 1)*
4. **[Candidato]** Entra y leIA lo saluda **por su nombre en menos de 2 segundos**, con voz natural y un avatar que respira, mira y mueve la boca al hablar. *(latencia + avatar — Etapa 1)*
5. **[Candidato]** En medio de una pregunta larga, el candidato interrumpe — **leIA se calla, escucha y retoma**. Este momento solo ya diferencia de todo lo que el cliente vio. *(barge-in — Etapa 1)*
6. **[Reclutador]** Mientras tanto, en **la sala de observación en vivo**: transcripción en tiempo real, la pregunta actual, el radar de dimensiones llenándose turno a turno, el estado de leIA (escuchando/pensando/hablando) y señales de atención del candidato. *(nuevo sobre el WS que ya existe — Etapa 2)*
7. **[Reclutador]** Escribe una sugerencia ("preguntale por qué dejó su último trabajo") → **leIA la incorpora naturalmente** en el siguiente turno. El reclutador siente control, no reemplazo. *(susurro — Etapa 2)*
8. **[Candidato]** Corta cuando termina → pantalla de cierre amable con próximos pasos.
9. **[Reclutador]** 30 segundos después: **informe completo** — resumen ejecutivo, radar vs. seniority esperado, sentimiento/calidad, momentos clave con citas, observaciones de comportamiento (con tacto), recomendación. Botón "compartir informe" con link. *(informe ya existe; share — Etapa 2)*
10. **Remate comercial:** "¿Tu cliente prefiere Meet? Funciona igual" → misma entrevista con el bot entrando a un Meet real. *(ya funciona; se pule en Etapa 3)*

Todo lo que no aporta a este guion queda fuera de la demo (aunque quede previsto).

---

## 3. Propuesta técnica por prioridad

### 3.1 WOW Candidato (sala nativa) — prioridad 1

**A. Latencia conversacional < ~1.5 s percibida** (hoy: varios segundos entre respuesta y voz)
- **STT streaming server-side** reemplazando Web Speech API como fuente primaria (Web Speech queda como fallback gratis): Deepgram Nova streaming o AssemblyAI Universal-Streaming. Elimina la fragilidad de Chrome-only y da parciales estables para cortar el turno antes (~300 ms en vez de 700 ms de silencio).
- **TTS streaming** reemplazando la síntesis por oración completa: ElevenLabs Flash v2.5 (WebSocket, ~75 ms TTFB) o Cartesia Sonic. El pipeline ya está preparado: `splitSentences()` (develop) pasa a ser chunking por tokens del LLM → TTS stream → WS de la sala.
- **LLM en streaming**: `LeiaService` gana una variante `evaluateStream()` — la evaluación JSON se sigue esperando completa, pero la `nextQuestion` se streamea a TTS apenas empieza. *(Punto de integración: la interface ya aísla esto; se agrega sin romper drivers actuales.)*
- **Muletillas inteligentes** (ya existen): pasan de "relleno aleatorio" a cubrir exactamente el gap LLM+TTS, elegidas por contexto (ya se pre-sintetizan filtradas — solo hay que medirlas contra el gap real).

**B. Barge-in (interrupciones) — el momento diferencial**
- Solo en sala nativa (mic independiente del speaker, sin eco físico; el engine del branch ya desactiva el half-duplex en browser).
- Cliente: si el VAD/parciales detectan habla del candidato mientras suena audio de leIA → pausar `<audio>`, mandar `{type:'interrupted'}` por WS.
- Engine: nuevo estado `interrupted` — descarta la cola de chunks TTS pendientes, marca la pregunta como parcialmente dicha y trata lo que venga como respuesta (o pedido de aclaración del candidato).
- En Meet (clase ejecutiva): no se promete barge-in v1; el half-duplex actual queda documentado como limitación del canal.

**C. Presencia: avatar con estados**
- **Tier estándar (demo):** avatar actual en video + animación audio-reactiva (amplitud del audio anima boca/cabeza vía canvas/CSS) + estados visuales: *escuchando* (leve movimiento), *pensando* (gesto + muletilla), *hablando*. Costo cero por minuto, control total, ya hay assets mp4.
- **Tier premium (previsto, feature-flag):** avatar foto-realista con lip-sync real vía Simli o HeyGen Interactive Avatar. Se integra donde hoy se monta el `<video>` de la sala/bot-stage. *(Solo maquetar el punto de integración; no comprar aún.)*
- **CC en vivo** en la sala (los commits del branch ya lo insinúan) + subtítulo de la pregunta actual (ya llega por WS `question`).

**D. Lobby y cierre**
- Lobby: chequeo de dispositivos, contexto del puesto, consentimiento explícito de grabación + análisis (esto habilita legalmente el punto 3.2-C), selector de idioma *(previsto: hoy es-AR fijo)*.
- Cierre: agradecimiento personalizado (ya existe `generateClosing`) + pantalla de próximos pasos.

**E. Contexto del candidato**
- Upload de CV en el alta del candidato (`cvUrl` ya existe en el modelo) → el texto entra al prompt de `firstQuestion`/`evaluate` → leIA referencia el CV real ("vi que estuviste 3 años en X…"). Wow barato y potente. *(Parsing: extracción simple de texto en v1.)*

### 3.2 WOW Reclutador — prioridad 2

**A. Sala de observación en vivo** — la feature de venta al cliente
- **El backend ya la emite entera y nadie la consume**: `WS /ws/interview/:id` manda `question_generated`, `caption_received`, `leia_evaluation_ready`, `candidate_speaking`, `report_ready`… (snapshot §3, INFER-06).
- Nueva página `/entrevistas/[id]/live`: transcripción en vivo, pregunta actual, radar de dimensiones que se llena turno a turno, score corriendo, estado de leIA, flags al instante ("respuesta vaga"), y miniatura de la cámara del candidato (en sala nativa, vía WebRTC simple o snapshots — v1 puede ser solo señales sin video).
- Es la conversión del reclutador: ve a la IA trabajar *para él* en tiempo real.

**B. Susurro (recruiter-in-the-loop)**
- Input en la sala de observación → mensaje WS `{type:'suggest_question', text}` → el engine lo encola con prioridad y leIA lo formula con su estilo en el próximo turno (pasando por el guard anti-repetición).
- Posiciona el producto como **copiloto, no reemplazo** — clave de venta a RRHH.

**C. Señales de comportamiento (anti-cheating ético)**
- Conectar lo que ya está construido: `useFaceAnalysis` (huérfano) se monta en la sala nativa → acumula `BehavioralAnalysis` → se envía en el `finalize` (el endpoint ya acepta `behavior`; los prompts de los informes ya lo consumen; el informe ya lo renderiza). **Es plomería, no construcción** (snapshot INFER-02).
- Sumar señales de browser baratas: pérdida de foco/cambio de pestaña, múltiples caras en frame.
- Presentación **como señales, nunca veredictos** ("se observó mirada baja el 32 % del tiempo"), con el consentimiento del lobby como habilitante. Umbral ya definido en prompts (>25 % → `suspectedReading`).

**D. Informe compartible y comparación**
- Link público de solo-lectura por informe (token firmado — primer uso real del `JWT_SECRET` ya configurado) + export PDF.
- *(Previsto, no demo):* vista "candidatos del puesto" con ranking por score — los datos ya lo permiten (`reports` por job).

### 3.3 Clase ejecutiva: Meet + Recall — el piso

- Mantener el flujo actual (bot + bot-stage + output_audio→WS fallback) y **pulir el arranque**: hoy el bot puede tardar en entrar; mostrar estado "leIA está entrando a la reunión…" en el detalle de entrevista (los eventos lifecycle ya llegan).
- La sala de observación (3.2-A) funciona idéntica en modo meet — mismo WS. Es el gran igualador entre canales.
- Documentar honestamente la matriz de capacidades por canal (barge-in: solo sala; behavior: solo sala; costo: distinto). El contrato `RecallService` ya soporta esta divergencia.

### 3.4 Saneo previo (bloqueantes del snapshot — 1-2 días)

Sin esto no hay branch demo estable:
1. **Merge** `develop` + `feature/sala-nativa` a `main` (historia lineal, sin conflictos).
2. **Eliminar `fromForm.ts`** (rompe `tsc`; la feature "puesto desde formulario" se re-especifica después si se quiere) — o completar sus tipos si se decide conservarla.
3. **`mode` en Postgres**: columna + CHECK + mapping en `postgres.ts` (patrón `ADD COLUMN IF NOT EXISTS` ya usado para `tts_driver`). La demo puede correr en memoria, pero este fix es barato y evita el 404 sorpresa.
4. README/SETUP: actualizar a la realidad (los 9 conflictos del snapshot §8.2).

---

## 4. Puntos de integración del producto real (previstos, comentados, NO construidos ahora)

Cada uno queda como interfaz/stub/comentario `// INTEGRACIÓN:` en el código de la demo:

| Punto | Dónde queda previsto | Nota |
|---|---|---|
| **Auth multi-tenant real** | El preHandler de `server.ts` se extrae a un `authPlugin` con TODO JWT; `NEXT_PUBLIC_ADMIN_TOKEN` queda marcado deprecado | El token estático es inaceptable post-demo (snapshot INFER-07) |
| **Storage de grabaciones** | `POST /api/sala/:id/recording` gana interface `RecordingStore` con impl `LogOnlyStore` (actual) y stub `S3Store` | Hoy solo loguea bytes |
| **ATS (Greenhouse/Lever/Workday)** | Webhook saliente `interview.completed` + módulo `integrations/` vacío con el contrato del evento | El `audit_logs` existente es la semilla del event log |
| **Motor "leIA propia"** | `LeiaService` intacto; se agrega `LeiaStreamCapable` como interface opcional | La promesa del README (IA propia) sigue viva vía driver |
| **Evaluación del propio agente (agent evals)** | Persistir por turno: prompt, respuesta cruda del LLM, latencias (columnas JSONB `telemetry` previstas) | Habilita regression-testing de prompts después |
| **Multi-idioma** | `INTERVIEW_LANGUAGE` ya existe; el selector del lobby lo setea por entrevista (campo nuevo previsto) | Voces Edge/Eleven ya son multilingües |
| **Facturación/metering** | Contador de minutos+tokens por entrevista en `telemetry` | Necesario para pricing SaaS |

---

## 5. Costos por entrevista (20 min) — "clase media" SaaS

> Estimaciones de orden de magnitud a validar contra pricing vigente al momento de contratar. Supuestos: ~8 min de habla de leIA (~7.000 caracteres TTS), ~12 min de habla del candidato (STT), ~15 llamadas LLM cortas + 2 informes.

| Componente | Piso actual (demo gratis) | **Tier Estándar propuesto** | Tier Premium (previsto) |
|---|---|---|---|
| STT | Web Speech (gratis, frágil) | Deepgram/AssemblyAI streaming ≈ **USD 0.08–0.15** | igual |
| TTS | Edge TTS (gratis, no contractual) | ElevenLabs Flash / Cartesia ≈ **USD 0.10–0.40** | ElevenLabs voces premium |
| LLM (leIA) | Gemini free tier (rate limit) | Gemini 2.5 Flash pago o Claude Haiku ≈ **USD 0.05–0.15** | Claude Sonnet p/ informes ≈ +0.10 |
| Avatar | mp4 audio-reactivo (gratis) | igual (gratis) | Simli/HeyGen ≈ +USD 1–3 ⚠️ |
| Canal Meet | — | Recall.ai ≈ **USD 0.20** (solo modo meet) | igual |
| **Total sala nativa** | ~USD 0 | **≈ USD 0.25–0.70** | ≈ USD 1.5–4 |
| **Total Meet** | ~USD 0.20 | **≈ USD 0.45–0.90** | ≈ USD 2–4 |

Lectura: el tier estándar queda en **menos de USD 1 por entrevista** — vendible con margen amplio a cualquier precio SaaS razonable (una entrevista humana de screening cuesta 30-60 USD de tiempo de reclutador). El avatar foto-realista es lo único que rompe la banda: por eso es tier premium con feature-flag, no default. La filosofía de fallbacks existente se mantiene: si el proveedor pago falla, se degrada a la cadena gratuita actual (Edge/mock) y la entrevista no se cae.

---

## 6. Roadmap (demo vendible en ~2-3 semanas)

**Etapa 0 — Saneo (días 1-2)**
Merge de branches, borrar/arreglar `fromForm.ts`, `mode` en Postgres, README real. *Salida: un `main` estable que compila y corre ambos modos.*

**Etapa 1 — Wow candidato (días 3-8)**
Lobby + consentimiento → STT streaming server-side (con Web Speech de fallback) → TTS streaming (ElevenLabs Flash o Cartesia) → barge-in en sala → avatar audio-reactivo con estados → CV en el contexto de leIA. *Salida: la entrevista del guion, pasos 3-5 y 8.*

**Etapa 2 — Wow reclutador (días 8-13)**
Sala de observación en vivo sobre el WS existente → susurro → conectar `useFaceAnalysis`→`BehavioralAnalysis`→informe → link compartible de informe. *Salida: pasos 6-7 y 9 del guion.*

**Etapa 3 — Clase ejecutiva y cierre (días 13-18)**
Pulido del modo Meet (estados de ingreso del bot, misma sala de observación), matriz de capacidades por canal, puntos de integración comentados (§4), guion de demo ensayado, seed con un puesto/candidato de demo realistas. *Salida: demo completa en ambos canales + repo listo para la fase producto.*

**Fuera de esta demo (backlog producto):** auth multi-tenant, ATS, ranking de candidatos, multi-idioma efectivo, avatar premium, agent evals, facturación.

---

## 7. Riesgos y decisiones abiertas

1. **Proveedor de voz:** elegir 1 STT y 1 TTS para no dispersar (recomendación: decidir con una prueba de latencia real de 1 día en Etapa 1; candidatos: Deepgram+ElevenLabs Flash vs. Gemini Live API todo-en-uno).
2. **Gemini Live API como atajo:** podría reemplazar STT+LLM+TTS con una sola API realtime (menos piezas, latencia excelente), pero acopla el arnés al proveedor y debilita la tesis "cerebro intercambiable". Recomendación: pipeline desacoplado en v1; Live API como driver experimental después.
3. **Análisis facial:** valor comercial alto pero sensibilidad ética/legal (AI Act, sesgos). Mitigación ya propuesta: consentimiento en lobby + "señales, no veredictos" + poder desactivarlo por puesto (flag en `JobPreferences`, previsto).
4. **Barge-in en Meet:** no prometerlo; el canal no lo permite limpiamente con la arquitectura actual (eco por altavoz del bot).
5. **Escalabilidad del arnés:** engines y buses viven en memoria de proceso (snapshot §9); para la demo alcanza, para producto es el primer refactor de la fase siguiente (queda comentado).

---

## 7-bis. Decisiones cerradas post-investigación (2026-07-06)

Con la investigación `INVESTIGACION_ECOSISTEMA_GOOGLE_2026-07.md` el product owner confirmó el modelo de tiers y canales:

| | **Sala nativa (1ª clase)** | **Meet (clase ejecutiva)** |
|---|---|---|
| **Default (comercial)** | Gemini Live API (3.1 Flash Live): barge-in nativo, latencia mínima, señales de cámara, avatar audio-reactivo · ~USD 0.30–0.40/entrevista | Pipeline TTS (Gemini/Chirp) + Recall.ai, half-duplex, misma sala de observación e informes · ~USD 0.50–0.60 |
| **Premium** | + avatar foto-realista (HeyGen/Simli, feature-flag) y voz de marca · +USD 2–4 | + voz premium |
| **Fallback (resiliencia, no comercial)** | Piezas GA (Chirp 3 STT/TTS) → Edge/mock | Edge/mock vía bot-stage WS |

Notas: (1) el default es a la vez lo más barato y lo más innovador — no confundir con la cadena gratuita, que es solo fallback; (2) Meet es un canal con techo físico (sin barge-in ni cámara), no un tier degradado: comparte informe, observación en vivo y susurro; (3) esto resuelve las decisiones abiertas §7.1 y §7.2 — queda abierta solo la §7.3 (análisis facial on/off por puesto, ya con mitigación definida).

---

## 8. Próximo paso sugerido (pipeline SDD)

Si esta propuesta se aprueba (total o recortada), el circuito es:
1. **ing-requisitos-sdd modo (b+c)** sobre el alcance de las Etapas 0-3 → snapshot ya existe; se genera el MD de **Cambios Propuestos** con Task Breakdown y BDD a-priori por etapa.
2. **arquitecto-sdd** valida el par y produce el Plan Ejecutor.
3. **desarrollador-sdd** implementa etapa por etapa (Etapa 0 es un ticket chico ideal para arrancar el circuito).
