import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db';
import { extractCvText } from '../services/interview/cv';
import { getLeia } from '../services/leia';
import { computeMatch } from '../services/matching';
import type { Candidate } from '../types';

const CV_MAX_BYTES = 5 * 1024 * 1024;

/**
 * RF-01 — Precedencia de puesto: no pueden existir postulantes flotantes.
 * El alta de un candidato exige el puesto al que se postula; la postulación
 * se crea en el mismo acto.
 */
const CreateCandidateSchema = z.object({
  jobId: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  cvUrl: z.string().url().optional(),
  notes: z.string().optional(),
});

const UpdateCandidateSchema = CreateCandidateSchema.partial().omit({ jobId: true });

export async function candidatesRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/pdf', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });
  // RF-03: el pipeline acepta también Word (.docx/.doc).
  // (application/octet-stream ya está registrado globalmente en server.ts.)
  app.addContentTypeParser(
    [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ],
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body);
    }
  );
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

    // RF-01: la vacante es la entidad madre — sin puesto no hay alta.
    const job = await db.getJob(parsed.data.jobId);
    if (!job) return reply.code(404).send({ error: 'job_not_found' });

    const exists = await db.getCandidateByEmail(parsed.data.email);
    if (exists) return reply.code(409).send({ error: 'email_already_exists' });

    const now = new Date().toISOString();
    const candidate: Candidate = {
      id: uuid(),
      email: parsed.data.email,
      name: parsed.data.name,
      lastName: parsed.data.lastName ?? null,
      phone: parsed.data.phone ?? null,
      location: parsed.data.location ?? null,
      cvUrl: parsed.data.cvUrl ?? null,
      notes: parsed.data.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await db.createCandidate(candidate);

    // El candidato queda asociado inmediatamente a la vacante (RF-01) con su
    // match calculado (RF-04), aunque todavía no tenga CV parseado.
    const match = computeMatch(job, candidate);
    const application = await db.createApplication({
      id: uuid(),
      jobId: job.id,
      candidateId: candidate.id,
      matchPercent: match.matchPercent,
      breakdown: match.breakdown,
      patterns: match.patterns,
      resumenEjecutivo: match.resumenEjecutivo,
      createdAt: now,
    });

    return reply.code(201).send({ ...candidate, application });
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

  app.post(
    '/api/candidates/:id/cv',
    { bodyLimit: CV_MAX_BYTES },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const db = await getDb();
      const candidate = await db.getCandidate(id);
      if (!candidate) return reply.code(404).send({ error: 'candidate_not_found' });

      const body = req.body as Buffer | undefined;
      if (!body || body.length === 0) return reply.code(400).send({ error: 'archivo_vacio' });

      const rawName = req.headers['x-file-name'];
      const fileName = (Array.isArray(rawName) ? rawName[0] : rawName) || 'cv.pdf';

      const cvText = await extractCvText(body, fileName);
      if (!cvText) return reply.code(422).send({ error: 'no_se_pudo_extraer_texto' });

      // RF-03: parsing IA de datos personales + ficha resumen.
      const parsedCv = await getLeia().parseCv({ cvText, fileName });
      const p = parsedCv.personal;

      const updated = await db.updateCandidate(id, {
        name: p.nombre ?? candidate.name,
        lastName: p.apellido ?? candidate.lastName ?? null,
        phone: p.telefono ?? candidate.phone ?? null,
        dni: p.dni ?? candidate.dni ?? null,
        birthDate: p.fechaNacimiento ?? candidate.birthDate ?? null,
        age: p.edad ?? candidate.age ?? null,
        location: p.ubicacion ?? candidate.location ?? null,
        cvUrl: fileName,
        cvText,
        profile: parsedCv.profile,
      });

      // RF-04: al llegar el CV recalculamos el match de todas sus postulaciones.
      if (updated) {
        const applications = await db.listApplications({ candidateId: id });
        for (const app of applications) {
          const job = await db.getJob(app.jobId);
          if (!job) continue;
          const match = computeMatch(job, updated);
          await db.createApplication({
            ...app,
            matchPercent: match.matchPercent,
            breakdown: match.breakdown,
            patterns: match.patterns,
            resumenEjecutivo: match.resumenEjecutivo,
          });
        }
      }

      return updated;
    }
  );
}
