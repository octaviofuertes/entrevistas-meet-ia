import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import { logger } from '../../logger';
import type { WebSocket } from 'ws';
import type {
  RecallService,
  JoinMeetInput,
  JoinMeetResult,
  PlayAudioInput,
} from './index';

// ============================================================
// Bus de mensajes para las conexiones WS de la sala nativa
// ============================================================
type SalaMsg =
  | { type: 'audio'; mimeType: string; audioBase64: string; durationMs: number }
  | { type: 'talking'; durationMs: number }
  | { type: 'question'; text: string; index: number; isClosing?: boolean }
  | { type: 'status'; status: string; reason?: string }
  | { type: 'finished' }
  | { type: 'report_ready'; kind: number }
  | { type: 'stop_audio' };

class BrowserSalaBus {
  private clients = new Map<string, WebSocket>();
  private buffered = new Map<string, SalaMsg[]>();
  private readySet = new Set<string>();

  register(interviewId: string, ws: WebSocket) {
    const old = this.clients.get(interviewId);
    if (old && old !== ws) { try { old.close(); } catch { /* noop */ } }
    this.clients.set(interviewId, ws);
    logger.info({ interviewId }, 'sala-browser: cliente conectado');

    ws.on('close', () => {
      if (this.clients.get(interviewId) === ws) {
        this.clients.delete(interviewId);
        this.readySet.delete(interviewId);
        logger.info({ interviewId }, 'sala-browser: cliente desconectado');
      }
    });
  }

  markReady(interviewId: string) {
    this.readySet.add(interviewId);
    const ws = this.clients.get(interviewId);
    if (ws) this.flushBuffer(interviewId, ws);
  }

  send(interviewId: string, msg: SalaMsg) {
    const ws = this.clients.get(interviewId);
    if (ws && (ws as any).readyState === 1 && this.readySet.has(interviewId)) {
      this.sendRaw(ws, msg);
      return;
    }
    const arr = this.buffered.get(interviewId) ?? [];
    arr.push(msg);
    this.buffered.set(interviewId, arr);
  }

  isConnected(interviewId: string): boolean {
    const ws = this.clients.get(interviewId);
    return !!(ws && (ws as any).readyState === 1);
  }

  private flushBuffer(interviewId: string, ws: WebSocket) {
    if ((ws as any).readyState !== 1) return;
    const pending = this.buffered.get(interviewId) ?? [];
    if (pending.length === 0) return;
    logger.info({ interviewId, n: pending.length }, 'sala-browser: flushing buffer');
    for (const m of pending) this.sendRaw(ws, m);
    this.buffered.delete(interviewId);
  }

  private sendRaw(ws: WebSocket, msg: SalaMsg) {
    try { ws.send(JSON.stringify(msg)); }
    catch (err) { logger.warn({ err }, 'sala-browser: send falló'); }
  }
}

export const browserSalaBus = new BrowserSalaBus();

// ============================================================
// BrowserRecall — implementa RecallService para entrevistas
// en el browser (sin Meet, sin Recall.ai).
//
// - joinMeet()  → emite lifecycle events inmediatamente
// - leaveMeet() → emite 'left'
// - playAudio() → envía el audio al browser via browserSalaBus
// - ingestCaption() → permite que el WS handler inyecte captions
// ============================================================
export class BrowserRecall implements RecallService {
  readonly events = new EventEmitter();
  private interviewId: string;

  constructor(interviewId: string) {
    this.interviewId = interviewId;
  }

  async joinMeet(input: JoinMeetInput): Promise<JoinMeetResult> {
    const botId = `browser_${input.interviewId}`;
    logger.info({ interviewId: input.interviewId }, 'BrowserRecall: sala nativa iniciada');
    // Emitir lifecycle inmediatamente (no hay bot real que esperar)
    process.nextTick(() => {
      this.events.emit('event', {
        type: 'lifecycle',
        payload: { interviewId: input.interviewId, botId, status: 'joining' },
      });
      setTimeout(() => {
        this.events.emit('event', {
          type: 'lifecycle',
          payload: { interviewId: input.interviewId, botId, status: 'joined' },
        });
      }, 300);
    });
    return { botId, meetUrl: '', status: 'joining' };
  }

  async leaveMeet({ interviewId, botId }: { interviewId: string; botId: string }) {
    browserSalaBus.send(interviewId, { type: 'finished' });
    this.events.emit('event', {
      type: 'lifecycle',
      payload: { interviewId, botId, status: 'left' },
    });
  }

  async playAudio(input: PlayAudioInput): Promise<{ playbackId: string; durationMs: number }> {
    const words = input.text.split(/\s+/).filter(Boolean).length;
    const durationMs = Math.max(1000, words * 320);
    browserSalaBus.send(input.interviewId, {
      type: 'audio',
      mimeType: input.mimeType,
      audioBase64: input.audioBase64,
      durationMs,
    });
    return { playbackId: `pb_${uuid()}`, durationMs };
  }

  /** El WS del candidato llama esto cuando llega un transcript. */
  ingestCaption(text: string, isFinal: boolean) {
    if (!text.trim()) return;
    this.events.emit('event', {
      type: 'caption',
      payload: {
        interviewId: this.interviewId,
        botId: `browser_${this.interviewId}`,
        speaker: 'candidate',
        text,
        startMs: Date.now(),
        endMs: Date.now() + 100,
        isFinal,
      },
    });
  }

  /** Envía el texto de la pregunta al frontend para mostrar como subtítulo. */
  forwardQuestion(text: string, index: number, isClosing = false) {
    browserSalaBus.send(this.interviewId, { type: 'question', text, index, isClosing });
  }

  /** Envía un status update al frontend. */
  forwardStatus(status: string, reason?: string) {
    browserSalaBus.send(this.interviewId, { type: 'status', status, reason });
  }

  /** Notifica al frontend que un informe está listo. */
  forwardReportReady(kind: number) {
    browserSalaBus.send(this.interviewId, { type: 'report_ready', kind });
  }
}

// Registro global de instancias por interview
const browserRecalls = new Map<string, BrowserRecall>();

export function getBrowserRecall(interviewId: string): BrowserRecall {
  let r = browserRecalls.get(interviewId);
  if (!r) {
    r = new BrowserRecall(interviewId);
    browserRecalls.set(interviewId, r);
  }
  return r;
}

export function disposeBrowserRecall(interviewId: string) {
  browserRecalls.delete(interviewId);
}
