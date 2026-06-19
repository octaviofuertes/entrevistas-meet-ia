# Agente IA · Entrevistas Meet · v2.0 (leIA)

Sistema de entrevistas automáticas en **Google Meet** según la guía técnica
*Agente_IA_Entrevistas_Meet_leIA_v2*. Implementa el stack del documento:

```
Google Meet
   ↓ (bot Recall.ai · captions nativos de Meet)
Backend Node.js (WebSockets)
   ↓
leIA  (IA propia del sistema · evalúa · genera preguntas · arma informes)
   ↓
ElevenLabs TTS
   ↓ (audio reproducido por el bot en la reunión)
Google Meet
```

Sin Deepgram. La inteligencia (evaluación, preguntas, informes) vive dentro
del sistema como **leIA**: en modo mock funciona end-to-end con heurísticas;
en producción podés enchufarle un motor por env (`LEIA_DRIVER`):

- `mock` (default) — heurística determinista, sin costo.
- `gemini` — Google Generative Language. Uso **temporal** hasta tener la IA
  propia. Modelo por defecto: `gemini-2.5-flash`.
- `claude` — Anthropic Claude.

El contrato público (`POST /api/leia/evaluate`, `POST /api/leia/next-question`,
informes 1 y 2) no cambia con el driver: leIA es la marca y la abstracción,
adentro vive el motor que esté configurado.

## Qué hay adentro

- **Backend** Fastify + WebSockets + TypeScript.
- **Frontend** Next.js 14 + Tailwind: `/puestos`, `/candidatos`, `/entrevistas`,
  sala en vivo y los dos informes por entrevista.
- **Persistencia** PostgreSQL (con `docker-compose`) o memoria.
- **Drivers** intercambiables por env:
  - `LEIA_DRIVER` = `mock` (default) · `gemini` · `claude`
  - `RECALL_DRIVER` = `mock` (default) o `recall`
  - `TTS_DRIVER` = `mock` (default) o `elevenlabs`
  - `DATABASE_DRIVER` = `memory` (default) o `postgres`

## Arrancar en 3 minutos (modo demo)

```bash
npm run install:all
cp .env.example .env
npm run dev
```

Después abrís http://localhost:3000.

Por defecto todo es mock: ni API key, ni Meet real, ni costo. El motor genera
puestos desde un link, agenda entrevistas con una URL `meet.google.com/...`
simulada, leIA evalúa con heurísticas y los dos informes se generan
automáticamente al cerrar la entrevista.

### Demo end-to-end

1. Dashboard → **Puesto desde link** → pegá cualquier URL (LinkedIn, Indeed,
   etc.). leIA arma el puesto con stack detectado + preferencias por defecto.
2. **Nueva entrevista**: elegí puesto + candidato. Se asigna una URL de Meet.
3. Abrí la sala en vivo y tocá **▶ Iniciar entrevista**.
4. En modo demo, escribí lo que diría el candidato y enviá. leIA evalúa,
   genera la siguiente pregunta, repite hasta cubrir las dimensiones o
   agotar el tiempo.
5. Al cerrar, aparecen **Informe 1** (transcripción + resumen) e **Informe 2**
   (evaluación + scoring + recomendación).

## Pasar a producción

Setear en `.env`:

```bash
DATABASE_DRIVER=postgres
LEIA_DRIVER=claude
ANTHROPIC_API_KEY=sk-ant-...
RECALL_DRIVER=recall
RECALL_API_KEY=...
TTS_DRIVER=elevenlabs
ELEVENLABS_API_KEY=...
PUBLIC_BASE_URL=https://tu-dominio.com
```

Levantar Postgres + Redis:

```bash
docker compose up -d
npm run seed --workspace=backend
```

El bot de Recall.ai necesita poder llamar a tu webhook
`POST /webhooks/recall/captions`. En producción exponé esa URL pública.

## Endpoints REST

Todos requieren `Authorization: Bearer ${ADMIN_TOKEN}` salvo `/api/health`,
`/ws/*` y `/webhooks/*`.

```
GET    /api/health
POST   /api/jobs/from-link        → crea Job a partir de un link
GET    /api/jobs
GET    /api/jobs/:id
POST   /api/candidates
GET    /api/candidates
POST   /api/interviews            → crea entrevista con URL de Meet
POST   /api/interviews/:id/start  → arranca el bot y leIA
POST   /api/interviews/:id/simulate-answer  (modo demo)
POST   /api/interviews/:id/finalize         → genera Informes 1 y 2
GET    /api/interviews/:id
POST   /api/leia/evaluate         → contrato del documento
POST   /api/leia/next-question
GET    /api/reports/:interviewId/1
GET    /api/reports/:interviewId/2
```

WebSocket: `ws://host/ws/interview/:id`. Eventos del documento:
`candidate_speaking`, `caption_received`, `leia_evaluation_ready`,
`question_generated`, `audio_generated`, `interview_finished`, `report_ready`.

## Estructura

```
backend/
  src/
    server.ts                 Fastify + rutas + WS
    config.ts
    db/                       memoria + postgres + schema v2
    services/
      leia/                   mock + claude
      recall/                 mock + recall.ai real
      tts/                    mock + elevenlabs
      jobs/fromLink.ts        link → Job
      interview/engine.ts     Orquesta el ciclo de la entrevista
    routes/                   jobs · candidates · interviews · leia · reports
    realtime/                 ws de entrevista + webhook de Recall.ai
frontend/
  app/
    puestos/                  link → puesto + listado/detalle
    candidatos/
    entrevistas/              listado + detalle + Informes 1 y 2
    entrevista-en-vivo/[id]/  sala en vivo con captions
docker-compose.yml            Postgres + Redis
```

## Costos por entrevista (20 min)

| Servicio       | v1 (Gemini)  | v2 (leIA)    |
|----------------|-------------:|-------------:|
| Recall.ai      | USD 0.20     | USD 0.20     |
| STT            | USD 0.01     | **USD 0.00** |
| IA evaluación  | USD 0.01     | (interno)    |
| ElevenLabs TTS | USD 0.02     | USD 0.02     |
| **Total ext.** | **USD 0.24** | **USD 0.22** |

Más allá del ahorro: toda la IA queda dentro del sistema. No salen datos
de candidatos a proveedores de IA externos.

## Licencia

MIT
