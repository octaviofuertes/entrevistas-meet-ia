# Guía de configuración v2.0

Cómo pasar del modo demo (mock) al stack completo del documento técnico:
**leIA + Recall.ai + ElevenLabs + Google Meet**.

## 1. Variables y drivers

Copiá `.env.example` a `.env`. Los drivers se eligen por variable:

| Variable          | Valores                          | Default |
|-------------------|----------------------------------|---------|
| `DATABASE_DRIVER` | `memory` · `postgres`            | memory  |
| `LEIA_DRIVER`     | `mock` · `gemini` · `claude`     | mock    |
| `RECALL_DRIVER`   | `mock` · `recall`                | mock    |
| `TTS_DRIVER`      | `mock` · `elevenlabs`            | mock    |

Cualquier combinación funciona. Por ejemplo, podés correr Postgres real
con leIA mock para testear la integración de BD sin pagar por IA.

## 2. PostgreSQL

```bash
docker compose up -d postgres
# El schema se carga solo (backend/src/db/schema.sql)

# En .env:
DATABASE_DRIVER=postgres
DATABASE_URL=postgresql://entrevistas:entrevistas@localhost:5432/entrevistas

# Cargar el seed (opcional)
npm run seed --workspace=backend
```

## 3. leIA — motor interno

leIA es la abstracción pública. Por dentro elegís el motor por env:

### 3a. Gemini (driver temporal — el que está activo ahora)

```bash
LEIA_DRIVER=gemini
GEMINI_API_KEY=AQ.Ab8R...   # API key de Google AI Studio
GEMINI_MODEL=gemini-2.5-flash
```

Notas:
- `gemini-2.5-flash` es el modelo por defecto. Si la cuenta es free tier
  tiene rate limit (~5 req/min); el driver hace **retry automático**
  respetando `retryDelay` y, si igual falla, cae al mock heurístico.
- Se desactiva el "thinking" (`thinkingConfig.thinkingBudget = 0`) para
  evitar que Gemini consuma los tokens de salida en razonamiento interno.

### 3b. Anthropic Claude

```bash
LEIA_DRIVER=claude
LEIA_MODEL=claude-opus-4-7
ANTHROPIC_API_KEY=sk-ant-...
```

Cualquier driver respeta el mismo contrato público
(`POST /api/leia/evaluate`, `POST /api/leia/next-question`, informes 1 y 2).

## 4. Recall.ai (bot en Google Meet)

1. Crear cuenta en https://www.recall.ai y obtener una API key.
2. Configurar:

```bash
RECALL_DRIVER=recall
RECALL_API_KEY=...
RECALL_REGION=us-east-1
RECALL_BOT_NAME=leIA · Entrevistadora
```

3. Recall.ai necesita poder llamar al webhook
   `POST /webhooks/recall/captions` con la transcripción nativa de Meet.
   Exponé esa URL pública (Cloudflare Tunnel, ngrok, dominio propio) y
   declarala en:

```bash
PUBLIC_BASE_URL=https://tu-dominio.com
```

El driver real crea el bot con `transcription_options.provider =
meeting_captions`, exactamente como pide el documento técnico: la
transcripción son los captions nativos de Meet, sin Deepgram ni STT propio.

## 5. ElevenLabs (TTS)

1. Crear API key en https://elevenlabs.io
2. Elegir voz multilingüe (default `21m00Tcm4TlvDq8ikWAM` — "Rachel").

```bash
TTS_DRIVER=elevenlabs
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
ELEVENLABS_MODEL=eleven_multilingual_v2
```

Si la llamada falla, vuelve al mock (audio MP3 silente para no bloquear el
flujo en producción).

## 6. Verificación

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
    "tts": "elevenlabs"
  },
  "demoMode": false,
  "version": "2.0.0"
}
```

## 7. Costos (entrevista de 20 min)

| Servicio       | Costo aprox |
|----------------|------------:|
| Recall.ai      | USD 0.20    |
| Captions Meet  | USD 0.00    |
| leIA (Claude)  | USD 0.05–0.10 |
| ElevenLabs     | USD 0.02    |

El documento técnico fija un objetivo de ~USD 0.22 con leIA, en línea con lo
anterior. El modelo y el modo de invocación de Claude permiten ajustar el costo.

## 8. Deploy

Recomendado:

- Backend: Cloud Run / Fly.io / cualquier host Node 18+.
- Frontend: Vercel.
- Postgres: Cloud SQL / RDS / Supabase.
- Webhook de Recall.ai apuntando al backend público.

Build:

```bash
npm run build
# backend: node dist/server.js
# frontend: next start -p 3000
```

## Troubleshooting

**El bot no aparece en la reunión** → revisar `RECALL_API_KEY`, que la URL de
Meet sea pública y que `PUBLIC_BASE_URL` esté seteada.

**No llegan captions** → confirmar que los subtítulos de Meet estén
disponibles en la cuenta del host. Algunos planes de Workspace los exponen
solo para hosts.

**leIA tarda mucho** → bajar `LEIA_MODEL` a una variante más rápida o cachear
las respuestas si tu plan lo permite.

**`unauthorized`** → todas las rutas REST (salvo `/api/health` y
`/webhooks/*`) requieren `Authorization: Bearer ${ADMIN_TOKEN}`.
