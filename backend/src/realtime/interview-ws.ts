import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { getDb } from '../db';
import { logger } from '../logger';
import { summarizeDrivers } from '../config';
import { getEngine } from '../services/interview/engine';

/**
 * WebSocket en vivo de una entrevista.
 *
 *   ws://host/ws/interview/:id
 *
 * Eventos server → cliente (JSON line):
 *   { type: 'hello', drivers }
 *   { type: 'interview_status', status, reason? }
 *   { type: 'lifecycle', ... }              // bot Recall
 *   { type: 'question_generated', question, index, isClosing? }
 *   { type: 'audio_generated', text, mimeType, durationMs, bytes }
 *   { type: 'caption_received', fragment }
 *   { type: 'candidate_speaking', isSpeaking }
 *   { type: 'bot_speaking', isSpeaking }
 *   { type: 'leia_evaluation_ready', evaluation, turnId }
 *   { type: 'report_ready', kind, report }
 *   { type: 'interview_finished', durationSec }
 *   { type: 'error', message }
 *
 * Mensajes cliente → server:
 *   { type: 'simulate_answer', text }       // útil para demo sin Meet
 *   { type: 'stop' }
 */
export async function interviewWsRoute(app: FastifyInstance) {
  app.get('/ws/interview/:id', { websocket: true }, async (socket: WebSocket, req) => {
    const db = await getDb();
    const { id } = req.params as { id: string };
    const interview = await db.getInterview(id);

    const send = (msg: unknown) => {
      try {
        socket.send(JSON.stringify(msg));
      } catch (err) {
        logger.warn({ err }, 'WS send falló');
      }
    };

    if (!interview) {
      send({ type: 'error', message: 'interview_not_found' });
      socket.close();
      return;
    }

    send({ type: 'hello', drivers: summarizeDrivers(), interviewId: id });

    const engine = getEngine(db, id);

    const forward = (evt: any) => send({ type: evt.type, ...envelope(evt) });
    engine.events.on('event', forward);

    // Mensajes entrantes
    socket.on('message', async (raw: Buffer) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send({ type: 'error', message: 'invalid_json' });
        return;
      }
      try {
        if (msg.type === 'simulate_answer') {
          await engine.simulateCandidateAnswer(String(msg.text ?? ''));
        } else if (msg.type === 'stop') {
          await engine.stop('manual');
        } else {
          send({ type: 'error', message: `unknown: ${msg.type}` });
        }
      } catch (err: any) {
        logger.error({ err }, 'WS interview error');
        send({ type: 'error', message: err?.message ?? 'internal' });
      }
    });

    socket.on('close', () => {
      engine.events.off('event', forward);
      logger.info({ interviewId: id }, 'WS interview cerrado');
    });
  });
}

function envelope(evt: any) {
  // El payload del Engine viene como { type, payload }. Lo aplanamos para el cliente.
  if (evt.payload && typeof evt.payload === 'object') return evt.payload;
  return {};
}
