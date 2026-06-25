import fs from 'fs';
import path from 'path';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { logger } from '../logger';

const AVATAR_DIR = path.resolve(process.cwd(), 'assets');

const VIDEO_FILES: Record<string, string> = {
  idle: 'idle_v.mp4',
  talk: 'hablando_v.mp4',
};

// Cache en memoria — los videos son pequeños (200-300 KB).
const videoCache = new Map<string, Buffer>();

export async function warmAvatarCache(): Promise<void> {
  for (const [key, fname] of Object.entries(VIDEO_FILES)) {
    const f = path.join(AVATAR_DIR, fname);
    if (!fs.existsSync(f)) { logger.warn({ key, f }, 'avatar video no encontrado'); continue; }
    try {
      const buf = fs.readFileSync(f);
      videoCache.set(key, buf);
      logger.info({ key, kb: Math.round(buf.length / 1024) }, 'avatar video cargado');
    } catch (err) {
      logger.warn({ err, key }, 'avatar video: error al leer');
    }
  }
}

/**
 * Bot Stage: webpage que Recall.ai carga dentro del bot.
 * Audio/video se streamean a Meet como voz y cámara de leIA.
 *
 * Endpoints:
 *   GET /bot-stage/:id          → HTML
 *   GET /bot-stage-video/:key   → MP4 (idle | talk)
 *   WS  /ws/bot-stage/:id       → canal de audio
 */

type StageMsg = { type: 'play'; mimeType: string; audioBase64: string };

class BotStageBus {
  private clients = new Map<string, WebSocket>();
  private buffered = new Map<string, StageMsg[]>();
  /** Timer de fallback: si la página no manda {type:'ready'} en 8s, flush igual. */
  private fallbackTimers = new Map<string, ReturnType<typeof setTimeout>>();

  register(interviewId: string, ws: WebSocket) {
    const old = this.clients.get(interviewId);
    if (old && old !== ws) { try { old.close(); } catch { /* noop */ } }
    this.clients.set(interviewId, ws);
    logger.info({ interviewId }, 'bot-stage: cliente conectado');

    // Fallback: si la página no envía {type:'ready'} en 8s, flush igual.
    const timer = setTimeout(() => {
      logger.warn({ interviewId }, 'bot-stage: timeout de ready, flushing buffer por fallback');
      this.flushBuffer(interviewId, ws);
    }, 8000);
    this.fallbackTimers.set(interviewId, timer);

    ws.on('close', () => {
      if (this.clients.get(interviewId) === ws) {
        const t = this.fallbackTimers.get(interviewId);
        if (t) { clearTimeout(t); this.fallbackTimers.delete(interviewId); }
        this.clients.delete(interviewId);
        logger.info({ interviewId }, 'bot-stage: cliente desconectado');
      }
    });
  }

  /** La página manda {type:'ready'} cuando el video ya está corriendo y pasaron 1.5s. */
  markReady(interviewId: string) {
    const t = this.fallbackTimers.get(interviewId);
    if (t) { clearTimeout(t); this.fallbackTimers.delete(interviewId); }
    logger.info({ interviewId }, 'bot-stage: página ready → flushing');
    const ws = this.clients.get(interviewId);
    if (ws) this.flushBuffer(interviewId, ws);
  }

  /** Conservado para compatibilidad (webhook de lifecycle que nunca llega vía realtime_endpoints). */
  activate(interviewId: string) {
    logger.info({ interviewId }, 'bot-stage: activate() llamado (sin efecto, usamos handshake)');
  }

  send(interviewId: string, msg: StageMsg) {
    const ws = this.clients.get(interviewId);
    if (ws && (ws as any).readyState === 1) { this.sendRaw(ws, msg); return; }
    const arr = this.buffered.get(interviewId) ?? [];
    arr.push(msg);
    this.buffered.set(interviewId, arr);
    logger.info({ interviewId, bufferedCount: arr.length }, 'bot-stage: bufferizado');
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
    return { connected, buffered, pending: [...this.fallbackTimers.keys()] };
  }

  private flushBuffer(interviewId: string, ws: WebSocket) {
    if ((ws as any).readyState !== 1) {
      logger.warn({ interviewId }, 'bot-stage: WS cerrado antes del flush, buffer conservado');
      return;
    }
    const pending = this.buffered.get(interviewId) ?? [];
    if (pending.length === 0) return;
    logger.info({ interviewId, n: pending.length }, 'bot-stage: flushing buffer');
    for (const m of pending) this.sendRaw(ws, m);
    this.buffered.delete(interviewId);
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
  html, body { margin: 0; padding: 0; width: 1280px; height: 720px; overflow: hidden; background: #202124; }
  video { position: absolute; top: 0; left: 0; width: 1280px; height: 720px;
          object-fit: cover; object-position: center; }
</style>
</head>
<body>
<video id="v-idle" autoplay loop muted playsinline preload="auto">
  <source src="/bot-stage-video/idle" type="video/mp4">
</video>
<video id="v-talk" loop muted playsinline preload="auto" style="display:none">
  <source src="/bot-stage-video/talk" type="video/mp4">
</video>
<audio id="player" preload="auto"></audio>
<script>
(function() {
  var interviewId = location.pathname.split('/').pop();
  var wsProto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  var wsUrl = wsProto + location.host + '/ws/bot-stage/' + interviewId;
  var player = document.getElementById('player');
  var vIdle  = document.getElementById('v-idle');
  var vTalk  = document.getElementById('v-talk');
  var queue = [], playing = false, currentUrl = null, talking = false;
  var ws = null, readySent = false;

  // Idle a 40% velocidad → 12fps efectivos para el encoder de Recall (en vez de 30fps).
  // P-frames vacíos para los frames repetidos → 60% menos CPU de encode cuando está idle.
  vIdle.addEventListener('canplay', function onCan() {
    vIdle.removeEventListener('canplay', onCan);
    vIdle.playbackRate = 0.4;
  });
  vTalk.load();

  function sendReady() {
    if (readySent || !ws || ws.readyState !== 1) return;
    readySent = true;
    try { ws.send(JSON.stringify({ type: 'ready' })); } catch(e) {}
  }

  vIdle.addEventListener('playing', function onP() {
    vIdle.removeEventListener('playing', onP);
    setTimeout(sendReady, 2000);
  });

  function setTalking(on) {
    on = !!on;
    if (on === talking) return;
    talking = on;
    if (on) {
      vIdle.style.display = 'none';
      vTalk.style.display = 'block';
      vTalk.currentTime = 0;
      vTalk.play().catch(function(){});
    } else {
      vTalk.style.display = 'none';
      vTalk.pause();
      vIdle.style.display = 'block';
    }
  }

  function revokeCurrent() {
    if (currentUrl) { try { URL.revokeObjectURL(currentUrl); } catch(e){} currentUrl = null; }
  }

  function b64ToBlob(b64, mime) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
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
      if (p && p.catch) p.catch(function() { finish(); });
    } catch(e) { finish(); }
  }

  function finish() {
    playing = false;
    if (queue.length === 0) setTalking(false);
    setTimeout(playNext, 30);
  }

  player.addEventListener('ended', finish);
  player.addEventListener('error', function() { finish(); });

  function connect() {
    ws = new WebSocket(wsUrl);
    ws.onopen = function() {
      if (!vIdle.paused && !readySent) setTimeout(sendReady, 2000);
    };
    ws.onmessage = function(e) {
      try {
        var msg = JSON.parse(e.data);
        if (msg.type === 'play') { queue.push(msg); playNext(); }
      } catch(e2) {}
    };
    ws.onclose = function() { ws = null; setTimeout(connect, 1000); };
    ws.onerror  = function() {};
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
    return reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').send(STAGE_HTML);
  });

  app.get('/bot-stage-diag', async () => botStageBus.diag());

  // Sirve los videos MP4 con soporte correcto de Range requests.
  // Sin esto el browser puede re-pedir el video completo varias veces → stutter.
  app.get('/bot-stage-video/:key', async (req, reply) => {
    const { key } = req.params as { key: string };
    const buf = videoCache.get(key);
    if (!buf) return reply.code(404).send({ error: 'no_video' });

    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const [startStr, endStr] = rangeHeader.replace('bytes=', '').split('-');
      const start = parseInt(startStr, 10);
      const end   = endStr ? parseInt(endStr, 10) : buf.length - 1;
      const chunk = buf.slice(start, end + 1);
      return reply
        .code(206)
        .type('video/mp4')
        .header('content-range',  `bytes ${start}-${end}/${buf.length}`)
        .header('accept-ranges',  'bytes')
        .header('cache-control',  'public, max-age=3600')
        .send(chunk);
    }

    return reply
      .type('video/mp4')
      .header('accept-ranges', 'bytes')
      .header('cache-control', 'public, max-age=3600')
      .send(buf);
  });

  app.get('/ws/bot-stage/:id', { websocket: true }, (socket: WebSocket, req) => {
    const { id } = req.params as { id: string };
    botStageBus.register(id, socket);
    // La página manda {type:'ready'} cuando el canvas ya está corriendo (ver STAGE_HTML).
    socket.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ready') botStageBus.markReady(id);
      } catch { /* noop */ }
    });
  });

  warmAvatarCache().catch((err) => logger.warn({ err }, 'avatar warm falló'));
}
