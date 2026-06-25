import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import { config, summarizeDrivers, isDemoMode } from './config';
import { logger } from './logger';
import { getDb } from './db';
import { candidatesRoutes } from './routes/candidates';
import { interviewsRoutes } from './routes/interviews';
import { reportsRoutes } from './routes/reports';
import { jobsRoutes } from './routes/jobs';
import { leiaRoutes } from './routes/leia';
import { interviewWsRoute } from './realtime/interview-ws';
import { recallWebhookRoute } from './realtime/recall-webhook';
import { botStageRoute } from './realtime/bot-stage';

async function buildServer() {
  const app = Fastify({
    logger,
    bodyLimit: 10 * 1024 * 1024,
    trustProxy: true,
  });

  await app.register(cors, {
    origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN.split(','),
    credentials: true,
  });
  await app.register(sensible);
  await app.register(websocket, { options: { maxPayload: 10 * 1024 * 1024 } });

  // Acepta POST con Content-Type application/json pero body vacío
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body.trim() : '';
    if (text.length === 0) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  app.get('/api/health', async () => {
    const drivers = summarizeDrivers();
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      drivers,
      demoMode: isDemoMode(),
      version: '2.0.0',
    };
  });

  app.addHook('preHandler', async (req, reply) => {
    const url = req.url || '';
    if (url.startsWith('/api/health')) return;
    if (url.startsWith('/ws/')) return;
    if (url.startsWith('/webhooks/')) return;
    if (url.startsWith('/bot-stage/')) return;
    if (url.startsWith('/bot-stage-diag')) return;
    if (url.startsWith('/bot-stage-avatar')) return;
    if (url.startsWith('/bot-stage-video')) return;

    const auth = req.headers.authorization;
    if (auth !== `Bearer ${config.ADMIN_TOKEN}`) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  await app.register(candidatesRoutes);
  await app.register(jobsRoutes);
  await app.register(interviewsRoutes);
  await app.register(leiaRoutes);
  await app.register(reportsRoutes);
  await app.register(interviewWsRoute);
  await app.register(recallWebhookRoute);
  await app.register(botStageRoute);

  await getDb();
  return app;
}

async function start() {
  const app = await buildServer();
  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    const drivers = summarizeDrivers();
    logger.info({ port: config.PORT, drivers, demoMode: isDemoMode() }, 'Backend v2 listo');
    if (isDemoMode()) {
      logger.info('MODO DEMO activo: leIA, Recall.ai y ElevenLabs en mock.');
    }
    // Validación crítica para Recall.ai
    if (config.RECALL_DRIVER === 'recall' && !process.env.PUBLIC_BASE_URL) {
      logger.warn('⚠️  RECALL_DRIVER=recall pero PUBLIC_BASE_URL no está configurado.');
      logger.warn('⚠️  Recall.ai NO podrá enviar webhooks a localhost.');
      logger.warn('⚠️  Ejecutá: npx tsx scripts/start-ngrok.ts y pegá la URL en .env');
    }
  } catch (err) {
    logger.fatal({ err }, 'Error al iniciar servidor');
    process.exit(1);
  }
}

start();
