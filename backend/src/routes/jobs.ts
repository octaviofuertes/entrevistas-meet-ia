import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db';
import { buildJobFromLink } from '../services/jobs/fromLink';
import { ALL_DIMENSIONS } from '../types';

const DimensionEnum = z.enum([
  'comunicacion',
  'tecnicos',
  'experiencia',
  'resolucion',
  'actitud',
  'trabajoEquipo',
]);

const FromLinkSchema = z.object({
  link: z.string().url(),
  preferences: z
    .object({
      durationMinutes: z.number().int().min(5).max(120).optional(),
      dimensionsToCover: z.array(DimensionEnum).min(1).optional(),
      toneOfVoice: z.enum(['formal', 'cercano', 'tecnico']).optional(),
      generateReport1: z.boolean().optional(),
      generateReport2: z.boolean().optional(),
    })
    .optional(),
  requirements: z
    .object({
      stack: z.array(z.string()).optional(),
      seniority: z.enum(['junior', 'semi', 'senior', 'lead']).optional(),
      yearsOfExperience: z.number().int().min(0).max(40).optional(),
      responsibilities: z.array(z.string()).optional(),
      niceToHave: z.array(z.string()).optional(),
      language: z.string().optional(),
    })
    .optional(),
});

export async function jobsRoutes(app: FastifyInstance) {
  app.get('/api/jobs', async () => {
    const db = await getDb();
    return { data: await db.listJobs() };
  });

  app.get('/api/jobs/:id', async (req, reply) => {
    const db = await getDb();
    const { id } = req.params as { id: string };
    const job = await db.getJob(id);
    if (!job) return reply.code(404).send({ error: 'job_not_found' });
    const interviews = await db.listInterviews({ jobId: id });
    return { ...job, interviews };
  });

  app.post('/api/jobs/from-link', async (req, reply) => {
    const parsed = FromLinkSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.flatten() });
    }
    const db = await getDb();
    const job = await buildJobFromLink(parsed.data.link, {
      preferences: parsed.data.preferences,
      requirements: parsed.data.requirements,
    });
    await db.createJob(job);
    await db.log({
      id: uuid(),
      entity: 'job',
      entityId: job.id,
      action: 'created_from_link',
      actor: 'system',
      metadata: { link: parsed.data.link, dimensions: job.preferences.dimensionsToCover, allDimensions: ALL_DIMENSIONS.length },
      timestamp: new Date().toISOString(),
    });
    return reply.code(201).send(job);
  });

  app.delete('/api/jobs/:id', async (req, reply) => {
    const db = await getDb();
    const { id } = req.params as { id: string };
    const ok = await db.deleteJob(id);
    if (!ok) return reply.code(404).send({ error: 'job_not_found' });
    return reply.code(204).send();
  });
}
