import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { logger } from '../logger';

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
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #202124; font-family: 'Google Sans', Roboto, system-ui, -apple-system, sans-serif; }
  .stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .avatar {
    width: 28vmin; height: 28vmin; max-width: 220px; max-height: 220px;
    border-radius: 50%;
    background: #5f6368;
    color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: 12vmin; font-weight: 400; line-height: 1;
    user-select: none;
  }
</style>
</head>
<body>
<div class="stage"><div class="avatar">L</div></div>
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

  app.get('/ws/bot-stage/:id', { websocket: true }, (socket: WebSocket, req) => {
    const { id } = req.params as { id: string };
    botStageBus.register(id, socket);
  });
}
