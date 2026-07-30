import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db';
import { buildJobFromLink } from '../services/jobs/fromLink';
import { buildJobFromForm } from '../services/jobs/fromForm';
import { generateQuestionsFor } from '../services/jobs/questions';
import { getLeia } from '../services/leia';
import { computeMatch } from '../services/matching';
import { extractCvText } from '../services/interview/cv';
import { ALL_DIMENSIONS } from '../types';
import type { Candidate, JobQuestion } from '../types';

const CV_MAX_BYTES = 5 * 1024 * 1024;

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

const PreferencesSchema = z.object({
  durationMinutes: z.number().int().min(5).max(120).optional(),
  dimensionsToCover: z.array(DimensionEnum).min(1).optional(),
  toneOfVoice: z.enum(['formal', 'cercano', 'tecnico']).optional(),
  generateReport1: z.boolean().optional(),
  generateReport2: z.boolean().optional(),
  requiredQuestions: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
});

/** RF-02 — Edición del banco de preguntas por el reclutador. */
const QuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        text: z.string().trim().min(5).max(300),
        kind: z.enum(['tecnica', 'situacional', 'descarte']),
        source: z.enum(['ia', 'manual']).optional(),
      })
    )
    .max(20),
});

const FromFormSchema = z.object({
  title: z.string().min(3),
  company: z.string().optional(),
  companyId: z.string().uuid().optional().nullable(),
  description: z.string().min(10),
  knowledge: z.string().min(3),
  location: z.string().optional(),
  salary: z.string().optional(),
  modality: z.enum(['presencial', 'hibrido', 'remoto']).optional(),
  vacancies: z.number().int().min(1).max(99).optional(),
  hiringStatus: z.enum(['abierto', 'pausado', 'cerrado']).optional(),
  publishedAt: z.string().datetime().optional(),
  language: z.string().optional(),
  preferences: PreferencesSchema.optional(),
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
    // RF-02: al guardar el puesto se genera automáticamente el banco de preguntas.
    job.questions = await generateQuestionsFor(job);
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

  app.post('/api/jobs/from-form', async (req, reply) => {
    const parsed = FromFormSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.flatten() });
    }
    const db = await getDb();
    let companyData = null;
    if (parsed.data.companyId) {
      companyData = await db.getCompany(parsed.data.companyId);
    }
    const job = await buildJobFromForm({ ...parsed.data, companyData });
    // RF-02: al guardar el puesto se genera automáticamente el banco de preguntas.
    job.questions = await generateQuestionsFor(job);
    await db.createJob(job);
    await db.log({
      id: uuid(),
      entity: 'job',
      entityId: job.id,
      action: 'created_from_form',
      actor: 'system',
      metadata: { dimensions: job.preferences.dimensionsToCover, allDimensions: ALL_DIMENSIONS.length },
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

  // ============================================================
  // RF-02 — Banco de preguntas: ver / editar / eliminar / regenerar
  // ============================================================
  app.get('/api/jobs/:id/questions', async (req, reply) => {
    const db = await getDb();
    const { id } = req.params as { id: string };
    const job = await db.getJob(id);
    if (!job) return reply.code(404).send({ error: 'job_not_found' });
    return { data: job.questions ?? [] };
  });

  /** Reemplaza el banco completo: permite editar, eliminar y reordenar. */
  app.put('/api/jobs/:id/questions', async (req, reply) => {
    const parsed = QuestionsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.flatten() });
    }
    const db = await getDb();
    const { id } = req.params as { id: string };
    const job = await db.getJob(id);
    if (!job) return reply.code(404).send({ error: 'job_not_found' });

    const questions: JobQuestion[] = parsed.data.questions.map((q) => ({
      id: q.id ?? uuid(),
      text: q.text.trim(),
      kind: q.kind,
      // Si el reclutador tocó el texto, deja de ser puramente generada por IA.
      source: q.source ?? 'manual',
    }));
    const updated = await db.updateJob(id, { questions });
    return { data: updated?.questions ?? [] };
  });

  /** Regenera el banco completo con IA, descartando el anterior. */
  app.post('/api/jobs/:id/questions/regenerate', async (req, reply) => {
    const db = await getDb();
    const { id } = req.params as { id: string };
    const job = await db.getJob(id);
    if (!job) return reply.code(404).send({ error: 'job_not_found' });

    const questions = await generateQuestionsFor(job);
    if (questions.length === 0) {
      return reply.code(503).send({ error: 'no_se_pudieron_generar_preguntas' });
    }
    const updated = await db.updateJob(id, { questions });
    return { data: updated?.questions ?? [] };
  });

  // ---- CV Screening — evaluación de CVs contra un puesto ----
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

  // ============================================================
  // RF-01/RF-03/RF-04 — Alta automática de candidatos desde el CV,
  // asociados SIEMPRE a la vacante, con match y detección de patrones.
  // ============================================================
  app.post(
    '/api/jobs/:id/applications',
    { bodyLimit: CV_MAX_BYTES },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const db = await getDb();
      const job = await db.getJob(id);
      if (!job) return reply.code(404).send({ error: 'job_not_found' });

      const body = req.body as Buffer | undefined;
      if (!body || body.length === 0) return reply.code(400).send({ error: 'archivo_vacio' });
      if (body.length > CV_MAX_BYTES) return reply.code(413).send({ error: 'archivo_demasiado_grande' });

      const rawName = req.headers['x-file-name'];
      const fileName = (Array.isArray(rawName) ? rawName[0] : rawName) || 'cv.pdf';

      // 1) Extracción de texto (PDF/DOCX)
      const cvText = await extractCvText(body, fileName);
      if (!cvText) return reply.code(422).send({ error: 'no_se_pudo_extraer_texto' });

      // 2) Parsing IA: datos personales + ficha resumen
      const leia = getLeia();
      const parsedCv = await leia.parseCv({ cvText, fileName });
      const p = parsedCv.personal;

      // 3) Alta / actualización del candidato (sin tipeo manual)
      const now = new Date().toISOString();
      const email = p.email ?? `sin-email-${uuid().slice(0, 8)}@cv.local`;
      const nombre =
        p.nombre ?? (fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Candidato');

      const existing = await db.getCandidateByEmail(email);
      const candidateData = {
        name: nombre,
        lastName: p.apellido,
        phone: p.telefono,
        dni: p.dni,
        birthDate: p.fechaNacimiento,
        age: p.edad,
        location: p.ubicacion,
        cvUrl: fileName,
        cvText,
        profile: parsedCv.profile,
      };

      const candidate = existing
        ? (await db.updateCandidate(existing.id, candidateData))!
        : await db.createCandidate({
            id: uuid(),
            email,
            ...candidateData,
            notes: null,
            createdAt: now,
            updatedAt: now,
          } as Candidate);

      // 4) Motor de matching + detección de patrones (determinístico)
      const match = computeMatch(job, candidate);

      // 5) Postulación: el CV queda asociado a la vacante
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

      return reply.code(201).send({ candidate, application });
    }
  );

  /** Listado de postulantes de la vacante, ordenado por match descendente. */
  app.get('/api/jobs/:id/applications', async (req, reply) => {
    const db = await getDb();
    const { id } = req.params as { id: string };
    const job = await db.getJob(id);
    if (!job) return reply.code(404).send({ error: 'job_not_found' });

    const applications = await db.listApplications({ jobId: id });
    const candidates = await Promise.all(applications.map((a) => db.getCandidate(a.candidateId)));
    return {
      data: applications.map((a, i) => ({ ...a, candidate: candidates[i] ?? null })),
    };
  });

  app.delete('/api/jobs/:id/applications/:applicationId', async (req, reply) => {
    const { applicationId } = req.params as { id: string; applicationId: string };
    const db = await getDb();
    const ok = await db.deleteApplication(applicationId);
    if (!ok) return reply.code(404).send({ error: 'application_not_found' });
    return reply.code(204).send();
  });

  app.post(
    '/api/jobs/:id/cv-screenings',
    { config: { skipAuth: false }, bodyLimit: CV_MAX_BYTES },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const db = await getDb();
      const job = await db.getJob(id);
      if (!job) return reply.code(404).send({ error: 'job_not_found' });

      const body = req.body as Buffer | undefined;
      if (!body || body.length === 0) return reply.code(400).send({ error: 'archivo_vacio' });
      if (body.length > CV_MAX_BYTES) return reply.code(413).send({ error: 'archivo_demasiado_grande' });

      const rawName = req.headers['x-file-name'];
      const fileName = (Array.isArray(rawName) ? rawName[0] : rawName) || 'cv.pdf';

      const cvText = await extractCvText(body);
      if (!cvText) return reply.code(422).send({ error: 'no_se_pudo_extraer_texto' });

      const leia = getLeia();
      const result = await leia.screenCv({ job, cvText, fileName });

      const screening = await db.createCvScreening({
        id: uuid(),
        jobId: id,
        fileName,
        ...result,
        createdAt: new Date().toISOString(),
      });

      return reply.code(201).send(screening);
    }
  );

  app.get('/api/jobs/:id/cv-screenings', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = await getDb();
    const job = await db.getJob(id);
    if (!job) return reply.code(404).send({ error: 'job_not_found' });
    const screenings = await db.listCvScreenings(id);
    return { data: screenings };
  });

  app.delete('/api/jobs/:id/cv-screenings/:screeningId', async (req, reply) => {
    const { screeningId } = req.params as { id: string; screeningId: string };
    const db = await getDb();
    const ok = await db.deleteCvScreening(screeningId);
    if (!ok) return reply.code(404).send({ error: 'screening_not_found' });
    return reply.code(204).send();
  });

  app.post('/api/jobs/:id/rank-candidates', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ candidateIds: z.array(z.string().uuid()).min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });

    const db = await getDb();
    const job = await db.getJob(id);
    if (!job) return reply.code(404).send({ error: 'job_not_found' });

    const resolved = await Promise.all(body.data.candidateIds.map((cid) => db.getCandidate(cid)));
    const valid = resolved
      .filter((c): c is NonNullable<typeof c> => !!c && !!c.cvText)
      .map((c) => ({ id: c.id, name: c.name, cvText: c.cvText! }));

    if (valid.length === 0) {
      return reply.code(400).send({ error: 'no_candidates_with_cv' });
    }

    const leia = getLeia();
    const rankings = await leia.rankCandidates({ job, candidates: valid });
    return { rankings };
  });
}
