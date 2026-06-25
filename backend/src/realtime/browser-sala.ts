import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { logger } from '../logger';
import { getDb } from '../db';
import { getEngine } from '../services/interview/engine';
import { getBrowserRecall, browserSalaBus } from '../services/recall/browser';

/**
 * Rutas para la sala de entrevista nativa en el browser (sin Meet ni Recall.ai).
 *
 * GET  /api/sala/:id/info           → info pública de la entrevista (para la página del candidato)
 * WS   /ws/sala/:id                 → canal bidireccional candidato ↔ backend
 * POST /api/sala/:id/recording      → subir grabación al terminar
 */
export async function browserSalaRoute(app: FastifyInstance) {
  // ---- Info pública (sin auth — el candidato accede con el link) ----
  app.get('/api/sala/:id/info', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = await getDb();
    const interview = await db.getInterview(id);
    if (!interview || interview.mode !== 'browser') {
      return reply.code(404).send({ error: 'sala_no_encontrada' });
    }
    const job = await db.getJob(interview.jobId);
    const candidate = await db.getCandidate(interview.candidateId);
    return {
      interviewId: id,
      status: interview.status,
      jobTitle: job?.title ?? '',
      company: job?.company ?? '',
      candidateName: candidate?.name ?? '',
      ttsDriver: interview.ttsDriver ?? 'edge',
    };
  });

  // ---- WebSocket bidireccional del candidato ----
  app.get('/ws/sala/:id', { websocket: true }, (socket: WebSocket, req) => {
    const { id } = req.params as { id: string };

    browserSalaBus.register(id, socket);

    socket.on('message', async (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'ready') {
          browserSalaBus.markReady(id);
          logger.info({ interviewId: id }, 'sala-browser: candidato listo');

          const db = await getDb();
          const iv = await db.getInterview(id);
          if (iv?.status === 'agendada' || iv?.status === 'pendiente') {
            const engine = getEngine(db, id);
            engine.start().catch((err) => {
              logger.error({ err, interviewId: id }, 'sala-browser: error al iniciar entrevista');
            });
          }
        }

        if (msg.type === 'transcript') {
          const { text, isFinal } = msg as { text: string; isFinal: boolean };
          const br = getBrowserRecall(id);
          br.ingestCaption(text, isFinal);
        }

        if (msg.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (err) {
        logger.warn({ err }, 'sala-browser: mensaje inválido');
      }
    });
  });

  // ---- Subir grabación (WebM/MP4 desde MediaRecorder) ----
  app.post(
    '/api/sala/:id/recording',
    { config: { skipAuth: true } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      // Por ahora solo logueamos y ack — en producción guardar en disco/S3
      const body = req.body as Buffer | undefined;
      const bytes = body?.length ?? 0;
      logger.info({ interviewId: id, bytes }, 'sala-browser: grabación recibida');
      return { ok: true, interviewId: id, bytes };
    }
  );
}
