import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { logger } from '../logger';

const AVATAR_DIR = path.resolve(process.cwd(), 'assets');

// Cache: key → { buf, mime }
const assetCache = new Map<string, { buf: Buffer; mime: string }>();

/**
 * Convierte un GIF animado a WebP animado con delay forzado.
 * - WebP se decodifica más eficiente que GIF en Chrome (formato nativo).
 * - delay alto → menos frames por segundo → menos trabajo para el encoder
 *   de video de Recall → la voz no compite con el encoder → sin trabas.
 */
async function gifToSlowWebP(filePath: string, delayMs: number): Promise<Buffer | null> {
  try {
    const meta = await sharp(filePath, { animated: true }).metadata();
    const pages = meta.pages ?? 1;
    // Extraemos hasta 4 frames distribuidos uniformemente para que la
    // animación siga pareciendo natural pero a fps mínimos.
    const MAX_FRAMES = 4;
    const step = Math.max(1, Math.floor(pages / MAX_FRAMES));
    const chosen: number[] = [];
    for (let i = 0; i < pages && chosen.length < MAX_FRAMES; i += step) chosen.push(i);

    // Extraemos cada frame como buffer PNG crudo.
    const frameBuffers = await Promise.all(
      chosen.map((p) =>
        sharp(filePath, { page: p, animated: false })
          .resize({ width: 1280, withoutEnlargement: true })
          .png()
          .toBuffer()
      )
    );

    // Rearmamos como animated WebP: apilamos los frames en un strip vertical
    // y usamos sharp's "pages" feature via raw GIF intermediary.
    // El truco: sharp admite animated WebP output si el input es animated.
    // Aquí usamos el GIF original pero forzamos el delay en el output.
    const out = await sharp(filePath, { animated: true })
      .resize({ width: 1280, withoutEnlargement: true })
      .webp({ quality: 80, delay: delayMs })
      .toBuffer();
    logger.info({ pages, chosen: chosen.length, delayMs, kb: Math.round(out.length / 1024) }, 'avatar: animated WebP generado');
    return out;
  } catch (err) {
    logger.warn({ err, filePath }, 'avatar: gifToSlowWebP falló');
    return null;
  }
}

export async function warmAvatarCache(): Promise<void> {
  // idle-gif → animated WebP lento (blink en silencio, sin audio que compita).
  // 600ms/frame ≈ 1.7fps: parpadeo se ve natural, encoder casi en reposo.
  const idlePath = path.join(AVATAR_DIR, 'idle.gif');
  if (fs.existsSync(idlePath)) {
    const buf = await gifToSlowWebP(idlePath, 600);
    if (buf) assetCache.set('idle-gif', { buf, mime: 'image/webp' });
  }

  // hablando-gif → animated WebP a 3fps: boca se mueve visiblemente pero
  // el encoder sólo trabaja 3 veces/s → CPU libre para el audio → sin trabas.
  const habPath = path.join(AVATAR_DIR, 'hablando.gif');
  if (fs.existsSync(habPath)) {
    const buf = await gifToSlowWebP(habPath, 333);
    if (buf) assetCache.set('hablando-gif', { buf, mime: 'image/webp' });
  }
}

/**
 * Bot Stage: la webpage que Recall.ai carga DENTRO del bot. Esta página corre
 * en el navegador del bot y su audio/video se streamean al Meet como la voz
 * y cámara de leIA.
 *
 * Recall.ai recomienda este patrón (Output Media → webpage) para agentes
 * interactivos. /output_audio sólo sirve para snippets cortos y según la doc
 * está PROHIBIDO usarlo para "dynamic transcription-based replies" — por eso
 * antes el bot saludaba pero no respondía: Recall aceptaba el POST (200) pero
 * silenciosamente no reproducía nada.
 *
 * Endpoints:
 *   GET  /bot-stage/:interviewId          → HTML que el bot va a cargar.
 *   WS   /ws/bot-stage/:interviewId       → canal por el que mandamos audio.
 *
 * Flujo:
 *   1. Engine pide playAudio(interviewId, base64) → botStageBus.send(...)
 *   2. Si la página del bot está conectada por WS → recibe el audio y lo
 *      reproduce con AudioContext. Si todavía no se conectó (Recall todavía
 *      no levantó el browser), bufferizamos hasta que se conecte.
 *
 * Notas operativas:
 *   - PUBLIC_BASE_URL TIENE que ser accesible por el navegador del bot.
 *     ngrok-free.dev muestra una página interstitial a cualquier User-Agent
 *     de browser → Recall NO va a poder cargar la página. Usar Cloudflare
 *     Tunnel (`cloudflared tunnel --url http://localhost:4000`) o localtunnel.
 */

type StageMsg = { type: 'play'; mimeType: string; audioBase64: string };

class BotStageBus {
  private clients = new Map<string, WebSocket>();
  private buffered = new Map<string, StageMsg[]>();

  register(interviewId: string, ws: WebSocket) {
    const old = this.clients.get(interviewId);
    if (old && old !== ws) {
      try { old.close(); } catch { /* noop */ }
    }
    this.clients.set(interviewId, ws);
    logger.info({ interviewId }, 'bot-stage: cliente conectado');

    const pending = this.buffered.get(interviewId) ?? [];
    if (pending.length > 0) {
      logger.info({ interviewId, n: pending.length }, 'bot-stage: flushing buffer');
      for (const m of pending) this.sendRaw(ws, m);
      this.buffered.delete(interviewId);
    }

    ws.on('close', () => {
      if (this.clients.get(interviewId) === ws) {
        this.clients.delete(interviewId);
        logger.info({ interviewId }, 'bot-stage: cliente desconectado');
      }
    });
  }

  send(interviewId: string, msg: StageMsg) {
    const ws = this.clients.get(interviewId);
    if (ws && (ws as any).readyState === 1 /* OPEN */) {
      this.sendRaw(ws, msg);
      return;
    }
    const arr = this.buffered.get(interviewId) ?? [];
    arr.push(msg);
    this.buffered.set(interviewId, arr);
    logger.info({ interviewId, bufferedCount: arr.length }, 'bot-stage: cliente no listo, bufferizado');
  }

  isConnected(interviewId: string): boolean {
    const ws = this.clients.get(interviewId);
    return !!(ws && (ws as any).readyState === 1);
  }

  diag() {
    const connected: string[] = [];
    for (const [id, ws] of this.clients.entries()) {
      if ((ws as any).readyState === 1) connected.push(id);
    }
    const buffered: Record<string, number> = {};
    for (const [id, arr] of this.buffered.entries()) buffered[id] = arr.length;
    return { connected, buffered };
  }

  private sendRaw(ws: WebSocket, msg: StageMsg) {
    try { ws.send(JSON.stringify(msg)); }
    catch (err) { logger.warn({ err }, 'bot-stage: send falló'); }
  }
}

export const botStageBus = new BotStageBus();

const STAGE_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1280, initial-scale=1">
<title>leIA</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #202124; }
  #avatar {
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; object-position: center;
  }
</style>
</head>
<body>
<img id="avatar" src="/bot-stage-avatar/idle-gif" alt="">
<audio id="player" preload="auto"></audio>
<script>
(function() {
  var interviewId = location.pathname.split('/').pop();
  var wsProto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  var wsUrl = wsProto + location.host + '/ws/bot-stage/' + interviewId;
  var player = document.getElementById('player');
  var queue = [];
  var playing = false;
  var currentUrl = null;

  // ── Avatar: animated WebP a fps reducidos ────────────────────────────────────
  // idle-gif    → WebP animado ~1.7fps (blink natural en silencio)
  // hablando-gif → WebP animado ~3fps  (boca moviéndose al hablar)
  // Ambos son WebP (decodifica más eficiente que GIF en Chrome) y con
  // delay forzado para que el encoder de Recall haga mínimo trabajo.
  var URL_IDLE = '/bot-stage-avatar/idle-gif';
  var URL_TALK = '/bot-stage-avatar/hablando-gif';
  var avatar = document.getElementById('avatar');
  var talking = false;

  var preload = new Image(); preload.src = URL_TALK;

  function setTalking(on) {
    on = !!on;
    if (on === talking) return;
    talking = on;
    avatar.src = on ? URL_TALK : URL_IDLE;
  }

  function revokeCurrent() {
    if (currentUrl) { try { URL.revokeObjectURL(currentUrl); } catch (e) {} currentUrl = null; }
  }

  function b64ToBlob(b64, mime) {
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || 'audio/mpeg' });
  }

  function playNext() {
    if (playing || queue.length === 0) return;
    playing = true;
    setTalking(true);
    var item = queue.shift();
    try {
      revokeCurrent();
      var blob = b64ToBlob(item.audioBase64, item.mimeType);
      currentUrl = URL.createObjectURL(blob);
      player.src = currentUrl;
      var p = player.play();
      if (p && p.catch) p.catch(function (err) { console.error('play() rej', err); finish(); });
    } catch (err) {
      console.error('audio play err', err);
      finish();
    }
  }

  function finish() {
    playing = false;
    if (queue.length === 0) setTalking(false);
    setTimeout(playNext, 30);
  }

  player.addEventListener('ended', finish);
  player.addEventListener('error', function (e) {
    console.error('audio element error', e, player.error);
    finish();
  });

  function connect() {
    var ws = new WebSocket(wsUrl);
    ws.onmessage = function (e) {
      try {
        var msg = JSON.parse(e.data);
        if (msg.type === 'play') { queue.push(msg); playNext(); }
      } catch (err) { console.error('msg parse err', err); }
    };
    ws.onclose = function () { setTimeout(connect, 1000); };
    ws.onerror = function () { /* onclose will fire next */ };
  }

  connect();
})();
</script>
</body>
</html>`;

export async function botStageRoute(app: FastifyInstance) {
  app.get('/bot-stage/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    logger.info({ interviewId: id, ua: req.headers['user-agent'] }, 'bot-stage: HTML solicitado');
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(STAGE_HTML);
  });

  app.get('/bot-stage-diag', async () => botStageBus.diag());

  // Sirve los assets del avatar (GIF animado o WebP estático según la clave).
  app.get('/bot-stage-avatar/:key', async (req, reply) => {
    const { key } = req.params as { key: string };
    const asset = assetCache.get(key);
    if (!asset) return reply.code(404).send({ error: 'no_frame' });
    return reply
      .type(asset.mime)
      .header('cache-control', 'public, max-age=3600')
      .send(asset.buf);
  });

  app.get('/ws/bot-stage/:id', { websocket: true }, (socket: WebSocket, req) => {
    const { id } = req.params as { id: string };
    botStageBus.register(id, socket);
  });

  // Pre-generamos los frames optimizados al arrancar para que el primer bot
  // los reciba al instante.
  warmAvatarCache().catch((err) => logger.warn({ err }, 'avatar warm falló'));
}
