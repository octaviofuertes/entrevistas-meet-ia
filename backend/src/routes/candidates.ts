import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db';
import type { Candidate } from '../types';

const CreateCandidateSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  phone: z.string().optional(),
  cvUrl: z.string().url().optional(),
  notes: z.string().optional(),
});

const UpdateCandidateSchema = CreateCandidateSchema.partial();

export async function candidatesRoutes(app: FastifyInstance) {
  app.get('/api/candidates', async () => {
    const db = await getDb();
    return { data: await db.listCandidates() };
  });

  app.get('/api/candidates/:id', async (req, reply) => {
    const db = await getDb();
    const { id } = req.params as { id: string };
    const c = await db.getCandidate(id);
    if (!c) return reply.code(404).send({ error: 'candidate_not_found' });
    return c;
  });

  app.post('/api/candidates', async (req, reply) => {
    const parsed = CreateCandidateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.flatten() });
    }
    const db = await getDb();
    const exists = await db.getCandidateByEmail(parsed.data.email);
    if (exists) return reply.code(409).send({ error: 'email_already_exists' });

    const now = new Date().toISOString();
    const candidate: Candidate = {
      id: uuid(),
      email: parsed.data.email,
      name: parsed.data.name,
      phone: parsed.data.phone ?? null,
      cvUrl: parsed.data.cvUrl ?? null,
      notes: parsed.data.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await db.createCandidate(candidate);
    return reply.code(201).send(candidate);
  });

  app.patch('/api/candidates/:id', async (req, reply) => {
    const parsed = UpdateCandidateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.flatten() });
    }
    const db = await getDb();
    const { id } = req.params as { id: string };
    const updated = await db.updateCandidate(id, parsed.data);
    if (!updated) return reply.code(404).send({ error: 'candidate_not_found' });
    return updated;
  });

  app.delete('/api/candidates/:id', async (req, reply) => {
    const db = await getDb();
    const { id } = req.params as { id: string };
    const ok = await db.deleteCandidate(id);
    if (!ok) return reply.code(404).send({ error: 'candidate_not_found' });
    return reply.code(204).send();
  });
}
