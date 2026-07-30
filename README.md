# Agente IA · Entrevistas · v2.0 (leIA)

Plataforma de entrevistas laborales conducidas por **leIA**, una entrevistadora
virtual que conversa por voz con el candidato en **dos canales**: una **sala
web propia** (sin Meet ni proveedores externos de videollamada) o dentro de
un **Google Meet real** (vía un bot de Recall.ai). En ambos casos leIA evalúa
cada respuesta, decide la siguiente pregunta y genera un informe con
puntajes, analítica y recomendación al terminar.

```
Sala nativa (browser)                    Google Meet
   ↓ WebSocket propio                       ↓ bot Recall.ai
   |                                        | (transcripción recallai_streaming)
   └──────────────┬─────────────────────────┘
                   ↓
         Backend Node.js (Fastify + WS)
                   ↓
   leIA (IA propia del sistema · evalúa · genera preguntas · arma informes)
                   ↓
              TTS (driver por entrevista)
                   ↓
         audio de vuelta al canal de origen
```

La inteligencia (evaluación, preguntas, informes) vive dentro del sistema
como **leIA**: en modo mock funciona end-to-end con heurísticas determinis­tas
(sin costo, sin API keys); en producción se le enchufa un motor por env
(`LEIA_DRIVER`):

- `mock` (default) — heurística determinista, sin costo.
- `gemini` — Google Generative Language. Modelo por defecto:
  `gemini-2.5-flash-lite`.
- `claude` — Anthropic Claude.

El contrato público (`POST /api/leia/evaluate`, `POST /api/leia/next-question`,
Informes 1 y 2) no cambia con el driver: leIA es la marca y la abstracción,
adentro vive el motor que esté configurado. **Nota de privacidad:** con los
drivers `gemini`/`claude` activos, la transcripción de la entrevista viaja al
proveedor externo correspondiente para su evaluación — no es una limitación
"temporal" a esconder, es el estado real del sistema hoy.

## Qué hay adentro

- **Backend** Fastify + WebSockets + TypeScript.
- **Frontend** Angular 15 + Tailwind: `/puestos` (desde link o formulario, con
  banco de preguntas generado por IA, carga de CVs y ranking de postulantes),
  `/empresas`, `/entrevistas` (listado, detalle, sala nativa e informe),
  `/sala/[id]` (la sala web propia del candidato).
- **Persistencia** PostgreSQL (con `docker-compose`) o memoria.
- **Drivers** intercambiables por env:
  - `LEIA_DRIVER` = `mock` (default) · `gemini` · `claude`
  - `RECALL_DRIVER` = `mock` (default) o `recall` (solo canal Meet)
  - `TTS_DRIVER` = `mock` (default) · `elevenlabs` · `gemini` · `edge`
    — además, **cada entrevista puede fijar su propia voz** (`gemini` o
    `edge`) independiente del driver global, editable mientras está
    `agendada` (`PATCH /api/interviews/:id/tts`).
  - `DATABASE_DRIVER` = `memory` (default) o `postgres`

## Matriz de capacidades por canal

| | Sala nativa (`/sala/:id`) | Google Meet (bot Recall.ai) |
|---|---|---|
| Requiere URL de Meet | No | Sí, se pega a mano al agendar (no se genera automáticamente) |
| Transcripción | Web Speech del navegador del candidato | `recallai_streaming` (STT propio de Recall.ai — **no** son los captions nativos de Meet) |
| Costo aproximado (20 min, drivers reales) | Sin Recall.ai | + Recall.ai ≈ USD 0.20 |
| Estado | Verificado con drivers reales (Gemini Live, TTS, CV) | Estable |

## Modo de voz: Live vs Pipeline

Cada entrevista fija su `voiceMode` al crearse (`POST /api/interviews`, campo
`voiceMode: "live" | "pipeline"`, default `pipeline`):

- **`pipeline`** (default) — ciclo clásico por turno: STT → leIA evalúa/genera
  la siguiente pregunta → TTS. Funciona en ambos canales.
- **`live`** — Gemini Live API conduce la conversación de punta a punta en
  tiempo real (audio↔audio), con **barge-in** (el candidato puede interrumpir
  a leIA y viceversa), **reconexión automática** ante cortes (session
  resumption + reintento con backoff) y menor latencia percibida. Requiere
  `GEMINI_API_KEY`. Si la sesión Live falla de forma irrecuperable, la
  entrevista cae automáticamente al modo `pipeline` para no cortar la
  experiencia del candidato.

## CV del candidato

El candidato puede subir su CV en PDF desde el lobby de la sala nativa
(`POST /api/sala/:id/cv`, sin auth — pensado para el flujo público del
candidato). El texto extraído (`cvText`) queda asociado a la entrevista y
leIA lo usa activamente: lo referencia con datos concretos (empresa,
tecnología, duración) en la apertura y los primeros turnos, y lo contrasta
contra lo conversado en los informes finales (coincidencias, temas no
explorados, inconsistencias con cita textual).

## Arrancar en 3 minutos (modo demo)

```bash
npm run install:all
cp .env.example .env
npm run dev
```

Después abrís http://localhost:4200.

Por defecto todo es mock: ni API key, ni Meet real, ni costo. El motor genera
puestos desde un link o desde un formulario, agenda entrevistas (sala nativa
o con una URL de Meet real pegada a mano), leIA evalúa con heurísticas y los
dos informes se generan automáticamente al cerrar la entrevista.

> **Nota de entorno:** el comando `npm run dev` (via `tsx watch`) necesita
> `.env` accesible desde `backend/` (los scripts de workspace corren con esa
> carpeta como directorio de trabajo) — si solo copiaste `.env` a la raíz,
> copialo también a `backend/.env`. Además, con `DATABASE_DRIVER=memory`
> (el default) en Node 20+ el arranque puede fallar por una incompatibilidad
> conocida de `tsx@3` con imports dinámicos (ver sección Troubleshooting);
> con `DATABASE_DRIVER=postgres` no ocurre.

### Demo end-to-end

1. Dashboard → **Puestos → Nuevo**: pestaña "Desde link" (pegá cualquier URL,
   leIA arma el puesto con stack detectado) o "Desde formulario" (cargás
   título, descripción, conocimientos y metadata — leIA estructura el resto).
2. **Nueva entrevista**: elegí puesto + candidato y el canal:
   - **Sala nativa**: no hace falta URL; se genera un link propio para
     compartir con el candidato. La entrevista arranca sola cuando el
     candidato se conecta.
   - **Google Meet**: pegá una URL real de `meet.google.com/...` y tocá
     "Iniciar entrevista" (esto abre el Meet y conecta el bot).
3. En modo demo (drivers mock), enviá texto simulando al candidato
   (`POST /api/interviews/:id/simulate-answer`, o desde la UI de la sala).
   leIA evalúa, genera la siguiente pregunta, repite hasta cubrir las
   dimensiones o agotar el tiempo.
4. Al cerrar (manual o automático al cortar), se genera un **informe único**
   por entrevista: resumen narrativo + transcripción (Informe 1) combinado
   con scoring, radar de competencias, analítica de sentimiento/calidad y
   recomendación (Informe 2).

## Pasar a producción

Setear en `.env` (en `backend/.env`, ver nota de entorno arriba):

```bash
DATABASE_DRIVER=postgres
LEIA_DRIVER=claude
ANTHROPIC_API_KEY=sk-ant-...
RECALL_DRIVER=recall
RECALL_API_KEY=...
TTS_DRIVER=edge          # o elevenlabs / gemini
ELEVENLABS_API_KEY=...   # si TTS_DRIVER=elevenlabs
PUBLIC_BASE_URL=https://tu-dominio.com
```

Levantar Postgres:

```bash
docker compose up -d postgres
npm run seed --workspace=backend
```

El bot de Recall.ai necesita poder llamar a tu webhook
`POST /webhooks/recall/captions` y cargar la página `GET /bot-stage/:id`
(el "escenario" con el avatar). En producción exponé el backend en una URL
pública (`PUBLIC_BASE_URL`).

## Endpoints REST

Todos requieren `Authorization: Bearer ${ADMIN_TOKEN}` **salvo**:
`/api/health`, `/ws/*`, `/webhooks/*`, `/bot-stage*` (la página y el WS que
carga el bot de Recall.ai) y `/api/sala/*` (la cara pública de la sala nativa
que usa el candidato, sin login).

```
GET    /api/health
POST   /api/jobs/from-link         → crea Job a partir de un link
POST   /api/jobs/from-form         → crea Job a partir de un formulario (leIA estructura stack/seniority)
GET    /api/jobs
GET    /api/jobs/:id
POST   /api/candidates
GET    /api/candidates
POST   /api/interviews             → crea entrevista (modo meet o browser)
PATCH  /api/interviews/:id/tts     → cambia la voz (solo en estado "agendada")
POST   /api/interviews/:id/start   → arranca el bot/sala y leIA
POST   /api/interviews/:id/simulate-answer  (modo demo)
POST   /api/interviews/:id/finalize         → genera Informes 1 y 2
GET    /api/interviews/:id
POST   /api/leia/evaluate          → contrato directo de leIA (fuera del flujo de entrevista)
POST   /api/leia/next-question
GET    /api/reports/:interviewId/1
GET    /api/reports/:interviewId/2
GET    /api/reports/by-interview/:interviewId
GET    /api/sala/:id/info          → info pública para la vista del candidato (sala nativa)
POST   /api/sala/:id/cv            → sube el CV en PDF del candidato (sin auth, sala nativa)
```

WebSockets:
- `ws://host/ws/interview/:id` — observador de la entrevista (transcripción,
  evaluaciones, estado en vivo). Emite todos los eventos del ciclo pero hoy
  ningún frontend lo consume todavía.
- `ws://host/ws/sala/:id` — canal bidireccional de la sala nativa (candidato).
- `ws://host/ws/bot-stage/:id` — canal de audio del bot en Google Meet.

## Estructura

```
backend/
  src/
    server.ts                 Fastify + rutas + WS
    config.ts
    db/                       memoria + postgres + schema
    services/
      leia/                   mock + gemini + claude (+ structureJob)
      recall/                 mock + recall.ai real + sala nativa (browser)
      tts/                    mock + elevenlabs + gemini + edge
      jobs/                   fromLink.ts (link → Job) + fromForm.ts (formulario → Job)
      interview/engine.ts     Orquesta el ciclo de la entrevista (ambos canales)
    routes/                   jobs · candidates · interviews · leia · reports
    realtime/                 ws de entrevista + webhook de Recall.ai + bot-stage + sala nativa
frontend-angular/
  src/app/
    pages/
      puestos/                desde link o formulario + detalle (preguntas IA, CVs, ranking)
      empresas/
      entrevistas/            listado + detalle (con selector de voz) + informe
      sala/                   sala nativa del candidato (sin Meet)
    services/api.service.ts   cliente REST/WS
    models/types.ts           tipos compartidos
docker-compose.yml            Postgres
```

## Costos por entrevista (20 min, drivers reales)

| Servicio | Sala nativa | Google Meet |
|---|---:|---:|
| Voz (Edge, gratis) | USD 0.00 | USD 0.00 |
| Voz (ElevenLabs, alternativa) | ~USD 0.30–0.40 | ~USD 0.30–0.40 |
| IA (Gemini/Claude, evaluación) | ~USD 0.01–0.10 | ~USD 0.01–0.10 |
| Recall.ai (bot en Meet) | — | ~USD 0.20 |

## Troubleshooting

**`npm run dev` falla con `TypeError: seedDb is not a function`** →
incompatibilidad conocida entre `tsx@3.14` y versiones recientes de Node en
imports dinámicos (`backend/src/db/memory.ts`, `backend/src/db/seed.ts`),
específica de `DATABASE_DRIVER=memory`. Workarounds: usar
`DATABASE_DRIVER=postgres`, o compilar y correr con Node directo
(`npm run build --workspace=backend && node backend/dist/server.js`).

**`.env` no se aplica** → confirmá que existe también en `backend/.env`
(no solo en la raíz); los scripts de workspace (`npm run dev --workspace=backend`)
corren con `backend/` como directorio de trabajo, y `dotenv` busca `.env`
relativo a ese cwd.

**El bot no aparece en la reunión (canal Meet)** → revisar `RECALL_API_KEY`,
que la URL de Meet sea pública y que `PUBLIC_BASE_URL` esté seteada a una URL
accesible por el navegador del bot (no localhost, no ngrok-free por su
página interstitial — usar Cloudflare Tunnel).

**`unauthorized`** → todas las rutas REST salvo las listadas arriba requieren
`Authorization: Bearer ${ADMIN_TOKEN}`.

## Licencia

MIT
