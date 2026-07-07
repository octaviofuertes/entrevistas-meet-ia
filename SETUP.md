# Guía de configuración v2.0

Cómo pasar del modo demo (mock) al stack completo: **leIA (Gemini/Claude) +
Recall.ai (canal Meet) + TTS real (Edge/ElevenLabs/Gemini) + sala nativa +
Google Meet**.

## 0. Ubicación de `.env`

Copiá `.env.example` a `.env` **en la raíz Y en `backend/.env`**. Los scripts
de npm workspaces (`npm run dev --workspace=backend`, y `npm run dev` desde
la raíz, que internamente los invoca) corren con `backend/` como directorio
de trabajo, y `dotenv` busca `.env` relativo a ese cwd — un `.env` solo en la
raíz no se aplica a esos comandos.

## 1. Variables y drivers

| Variable          | Valores                                    | Default |
|-------------------|---------------------------------------------|---------|
| `DATABASE_DRIVER` | `memory` · `postgres`                       | memory  |
| `LEIA_DRIVER`     | `mock` · `gemini` · `claude`                | mock    |
| `RECALL_DRIVER`   | `mock` · `recall` (solo canal Meet)         | mock    |
| `TTS_DRIVER`      | `mock` · `elevenlabs` · `gemini` · `edge`   | mock    |

Cualquier combinación funciona. Por ejemplo, podés correr Postgres real
con leIA mock para testear la integración de BD sin pagar por IA. Además,
**cada entrevista puede fijar su propia voz** (`gemini` o `edge`) sin tocar
la variable global, vía `PATCH /api/interviews/:id/tts` (solo mientras está
en estado `agendada`).

## 2. PostgreSQL

```bash
docker compose up -d postgres
# El schema se carga solo (backend/src/db/schema.sql) al iniciar el backend

# En .env (raíz y backend/.env):
DATABASE_DRIVER=postgres
DATABASE_URL=postgresql://entrevistas:entrevistas@localhost:5433/entrevistas

# Cargar el seed (opcional)
npm run seed --workspace=backend
```

**Nota:** con `DATABASE_DRIVER=memory` (el default) y Node 20+, `npm run dev`
puede fallar en el arranque con `TypeError: seedDb is not a function` — es
una incompatibilidad conocida entre `tsx@3.14` y versiones recientes de Node
en la resolución de imports dinámicos, específica del driver de memoria (no
ocurre con `postgres`). Workaround si necesitás memoria: compilar y correr
con Node directo (`npm run build --workspace=backend && node backend/dist/server.js`).

## 3. leIA — motor interno

leIA es la abstracción pública. Por dentro elegís el motor por env:

### 3a. Gemini

```bash
LEIA_DRIVER=gemini
GEMINI_API_KEY=AQ.Ab8R...   # API key de Google AI Studio
GEMINI_MODEL=gemini-2.5-flash-lite
```

Notas:
- Si la cuenta es free tier tiene rate limit (~5 req/min); el driver hace
  **retry automático** respetando `retryDelay` y, si igual falla, cae al
  mock heurístico.
- Se desactiva el "thinking" (`thinkingConfig.thinkingBudget = 0`) para
  evitar que Gemini consuma los tokens de salida en razonamiento interno.
- La misma `GEMINI_API_KEY` habilita `structureJob()` (puesto desde
  formulario) y, si se configura, `GEMINI_TTS_MODEL`/`GEMINI_TTS_VOICE` para
  el driver de voz `gemini`.

### 3b. Anthropic Claude

```bash
LEIA_DRIVER=claude
LEIA_MODEL=claude-opus-4-7
ANTHROPIC_API_KEY=sk-ant-...
```

Cualquier driver respeta el mismo contrato público
(`POST /api/leia/evaluate`, `POST /api/leia/next-question`, informes 1 y 2).

**Privacidad:** con `gemini` o `claude` activos, la transcripción de la
entrevista viaja a ese proveedor externo para su evaluación. El modo `mock`
es el único 100% local.

## 4. Canal Meet: Recall.ai (bot en Google Meet)

1. Crear cuenta en https://www.recall.ai y obtener una API key.
2. Configurar:

```bash
RECALL_DRIVER=recall
RECALL_API_KEY=...
RECALL_REGION=us-east-1
RECALL_BOT_NAME=leIA · Entrevistadora
```

3. Recall.ai necesita poder llamar al webhook `POST /webhooks/recall/captions`
   y cargar la página `GET /bot-stage/:id` (el "escenario" con el avatar del
   bot). Exponé el backend en una URL pública (Cloudflare Tunnel — **no**
   ngrok-free, que muestra una página interstitial que rompe la carga del
   bot-stage) y declarala en:

```bash
PUBLIC_BASE_URL=https://tu-dominio.com
```

El driver real usa `recording_config.transcript.provider.recallai_streaming`
— es el **STT propio de Recall.ai**, no los captions nativos de Google Meet
(no depende de que el host tenga subtítulos habilitados). El audio de leIA
se envía primero por `output_audio` (si el TTS activo es MP3, ej. `edge`) y
cae a WebSocket contra el bot-stage como fallback (siempre para audio WAV,
ej. `gemini`).

## 5. Canal sala nativa (sin Meet)

No requiere configuración de proveedor: el candidato entra directo a
`/sala/:id` (link generado al agendar la entrevista en modo `browser`), la
transcripción corre con Web Speech del navegador del candidato, y el audio
de leIA viaja por el WebSocket propio (`/ws/sala/:id`). Costo: solo el driver
de leIA y de TTS que elijas (sin Recall.ai).

## 6. TTS (síntesis de voz)

| Driver | Costo | Notas |
|---|---|---|
| `mock` | gratis | audio placeholder, no reproduce nada real |
| `edge` | gratis | Microsoft Edge Read-Aloud, sin API key, voces neuronales (`es-AR-ElenaNeural` default) |
| `gemini` | según `GEMINI_API_KEY` | reutiliza la key de leIA; PCM→WAV |
| `elevenlabs` | de pago | voces premium |

```bash
TTS_DRIVER=edge
# o
TTS_DRIVER=elevenlabs
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
ELEVENLABS_MODEL=eleven_multilingual_v2
```

Si la llamada al proveedor falla, el sistema cae en cadena (`gemini`→`edge`→
mock, `elevenlabs`→mock) para no cortar la entrevista en curso.

## 7. Verificación

```bash
curl -H "Authorization: Bearer admin-demo-token-cambiar" \
  http://localhost:4000/api/health
```

Esperado en producción:

```json
{
  "status": "ok",
  "drivers": {
    "database": "postgres",
    "leia": "claude",
    "recall": "recall",
    "tts": "edge"
  },
  "demoMode": false,
  "version": "2.0.0"
}
```

## 8. Costos (entrevista de 20 min, drivers reales)

| Servicio | Sala nativa | Google Meet |
|---|---:|---:|
| Voz (Edge) | USD 0.00 | USD 0.00 |
| Voz (ElevenLabs) | ~USD 0.30–0.40 | ~USD 0.30–0.40 |
| leIA (Claude/Gemini) | ~USD 0.01–0.10 | ~USD 0.01–0.10 |
| Recall.ai | — | ~USD 0.20 |

## 9. Deploy

Recomendado:

- Backend: Cloud Run / Fly.io / cualquier host Node 18+.
- Frontend: Vercel.
- Postgres: Cloud SQL / RDS / Supabase.
- Webhook de Recall.ai apuntando al backend público (solo si usás el canal Meet).

Build:

```bash
npm run build
# backend: node dist/server.js  (ejecutar desde backend/, o pasar --env-file si corrés desde la raíz)
# frontend: next start -p 3000
```

## Troubleshooting

**`npm run dev` falla con `TypeError: seedDb is not a function`** → ver
nota de la sección 2 (incompatibilidad `tsx@3`/Node reciente, solo en modo
memoria).

**`.env` no se aplica / sigue en modo mock** → confirmá que existe también
en `backend/.env`, no solo en la raíz (sección 0).

**El bot no aparece en la reunión (canal Meet)** → revisar `RECALL_API_KEY`,
que la URL de Meet sea pública y que `PUBLIC_BASE_URL` esté seteada a una
URL accesible por el navegador del bot.

**No llegan transcripts (canal Meet)** → `recallai_streaming` no depende de
los subtítulos de Meet, pero sí de que el bot esté efectivamente en la
llamada; revisar logs de `bot.joined`/`bot.fatal` en el webhook.

**leIA tarda mucho** → bajar `LEIA_MODEL`/`GEMINI_MODEL` a una variante más
rápida.

**`unauthorized`** → todas las rutas REST salvo `/api/health`, `/ws/*`,
`/webhooks/*`, `/bot-stage*` y `/api/sala/*` requieren
`Authorization: Bearer ${ADMIN_TOKEN}`.
