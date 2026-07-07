import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { v4 as uuid } from 'uuid';
import { logger } from '../logger';
import { getDb } from '../db';
import { getEngine, disposeEngine } from '../services/interview/engine';
import { getBrowserRecall, browserSalaBus } from '../services/recall/browser';
import { getVoiceSession } from '../services/voice/live-session';
import { extractCvText } from '../services/interview/cv';

const CV_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Rutas para la sala de entrevista nativa en el browser (sin Meet ni Recall.ai).
 *
 * GET  /api/sala/:id/info           → info pública de la entrevista (para la página del candidato)
 * WS   /ws/sala/:id                 → canal bidireccional candidato ↔ backend
 * POST /api/sala/:id/recording      → subir grabación al terminar
 * POST /api/sala/:id/cv             → subir CV en PDF (opcional)
 */
export async function browserSalaRoute(app: FastifyInstance) {
  // Parser acotado a este módulo (encapsulación de plugin de Fastify): el CV
  // llega como PDF crudo en el body, no como JSON.
  app.addContentTypeParser('application/pdf', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

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
      voiceMode: interview.voiceMode ?? 'pipeline',
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
          const consentRecording = !!msg.consentRecording;
          const consentAnalysis = !!msg.consentAnalysis;

          const db = await getDb();
          await db.updateInterview(id, { consentRecording, consentAnalysis });
          await db.log({
            id: uuid(),
            entity: 'interview',
            entityId: id,
            action: consentRecording ? 'consent_given' : 'consent_denied',
            actor: 'candidate',
            metadata: { consentAnalysis },
            timestamp: new Date().toISOString(),
          });

          if (!consentRecording) {
            logger.warn({ interviewId: id }, 'sala-browser: candidato sin consentimiento de grabación, entrevista no inicia');
            return;
          }

          browserSalaBus.markReady(id);
          logger.info({ interviewId: id }, 'sala-browser: candidato listo');

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

        // Audio crudo del candidato (modo live) — pausado a tiempo real por el
        // cliente, se reenvía tal cual a la sesión Live vía sendRealtimeInput.
        if (msg.type === 'candidate_audio') {
          const { pcmBase64 } = msg as { pcmBase64: string };
          const vs = getVoiceSession(id);
          vs?.sendCandidateAudio(Buffer.from(pcmBase64, 'base64'));
        }

        if (msg.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
        }

        // El candidato colgó manualmente → finalizar y generar informe
        if (msg.type === 'hangup') {
          const db = await getDb();
          const iv = await db.getInterview(id);
          if (iv?.status === 'en_curso') {
            const engine = getEngine(db, id);
            engine.stop('manual').catch((err) => {
              logger.error({ err, interviewId: id }, 'sala-browser: hangup stop falló');
            });
          }
        }
      } catch (err) {
        logger.warn({ err }, 'sala-browser: mensaje inválido');
      }
    });

    // Fallback: si el WS se cierra sin hangup explícito, finalizar igual
    socket.on('close', async () => {
      try {
        const db = await getDb();
        const iv = await db.getInterview(id);
        if (iv?.status === 'en_curso') {
          logger.info({ interviewId: id }, 'sala-browser: WS cerrado, finalizando entrevista');
          const engine = getEngine(db, id);
          engine.stop('auto').catch((err) => {
            logger.error({ err, interviewId: id }, 'sala-browser: close stop falló');
          });
        }
      } catch (err) {
        logger.warn({ err }, 'sala-browser: error en close handler');
      }
    });
  });

  // ---- Finalizar entrevista y generar informe (sin auth — llamado desde la sala del candidato) ----
  app.post('/api/sala/:id/finalize', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = await getDb();
    const interview = await db.getInterview(id);
    if (!interview || interview.mode !== 'browser') {
      return reply.code(404).send({ error: 'sala_no_encontrada' });
    }
    if (interview.status === 'completada') {
      const r1 = await db.getReport(id, 1);
      const r2 = await db.getReport(id, 2);
      return { ok: true, alreadyDone: true, reports: { r1, r2 } };
    }
    const engine = getEngine(db, id);
    const reports = await engine.stop('manual');
    disposeEngine(id);
    return { ok: true, reports };
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

  // ---- Subir CV en PDF (opcional, sin auth — llamado desde el lobby) ----
  app.post(
    '/api/sala/:id/cv',
    { config: { skipAuth: true } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as Buffer | undefined;
      if (!body || body.length === 0) {
        return reply.code(400).send({ error: 'archivo_vacio' });
      }
      if (body.length > CV_MAX_BYTES) {
        return reply.code(413).send({ error: 'archivo_demasiado_grande' });
      }
      const cvText = await extractCvText(body);
      const db = await getDb();
      await db.updateInterview(id, { cvText });
      logger.info({ interviewId: id, extracted: !!cvText }, 'sala-browser: CV procesado');
      return { ok: true, extracted: !!cvText };
    }
  );
}
