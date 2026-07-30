import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db';

const CompanyBodySchema = z.object({
  name: z.string().min(1).max(200),
  logoUrl: z.string().max(2_000_000).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  cuit: z.string().max(30).optional().nullable(),
  mission: z.string().max(2000).optional().nullable(),
  vision: z.string().max(2000).optional().nullable(),
  type: z.enum(['privada', 'publica', 'mixta']).optional().nullable(),
});

export async function companiesRoutes(app: FastifyInstance) {
  app.get('/api/companies', async () => {
    const db = await getDb();
    return { data: await db.listCompanies() };
  });

  app.get('/api/companies/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = await getDb();
    const company = await db.getCompany(id);
    if (!company) return reply.code(404).send({ error: 'company_not_found' });
    return company;
  });

  app.post('/api/companies', async (req, reply) => {
    const parsed = CompanyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.flatten() });
    }
    const db = await getDb();
    const now = new Date().toISOString();
    const company = await db.createCompany({
      id: uuid(),
      ...parsed.data,
      logoUrl: parsed.data.logoUrl ?? null,
      country: parsed.data.country ?? null,
      cuit: parsed.data.cuit ?? null,
      mission: parsed.data.mission ?? null,
      vision: parsed.data.vision ?? null,
      type: parsed.data.type ?? null,
      createdAt: now,
      updatedAt: now,
    });
    return reply.code(201).send(company);
  });

  app.patch('/api/companies/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = CompanyBodySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.flatten() });
    }
    const db = await getDb();
    const updated = await db.updateCompany(id, parsed.data);
    if (!updated) return reply.code(404).send({ error: 'company_not_found' });
    return updated;
  });

  app.delete('/api/companies/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = await getDb();
    const ok = await db.deleteCompany(id);
    if (!ok) return reply.code(404).send({ error: 'company_not_found' });
    return reply.code(204).send();
  });
}
