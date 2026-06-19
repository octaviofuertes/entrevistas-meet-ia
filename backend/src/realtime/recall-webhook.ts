import type { FastifyInstance } from 'fastify';
import { config } from '../config';
import { logger } from '../logger';
import { getRecall } from '../services/recall';
import { RealRecall } from '../services/recall/real';

/**
 * Webhook que Recall.ai llama con captions, lifecycle y demás eventos del bot.
 *   POST /webhooks/recall/captions
 *
 * Estos eventos se reenvían al EventEmitter del adaptador real para que el
 * InterviewEngine los procese exactamente igual que los del mock.
 */
export async function recallWebhookRoute(app: FastifyInstance) {
  app.post('/webhooks/recall/captions', async (req, reply) => {
    if (config.RECALL_DRIVER !== 'recall') {
      return reply.code(200).send({ ok: true, ignored: 'mock_driver' });
    }
    const recall = getRecall();
    if (!(recall instanceof RealRecall)) {
      return reply.code(200).send({ ok: true });
    }

    try {
      recall.ingestWebhook(req.body);
    } catch (err) {
      logger.warn({ err }, 'recall webhook: ingest falló');
    }
    return reply.code(200).send({ ok: true });
  });
}
