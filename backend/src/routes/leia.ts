import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db';
import { getLeia } from '../services/leia';

/**
 * Contratos directos definidos en el documento técnico v2.0:
 *   POST /leia/evaluate       evalúa una respuesta
 *   POST /leia/next-question  genera la siguiente pregunta
 *
 * Estos endpoints permiten consumir leIA por fuera del flujo de entrevista.
 */
const EvaluateSchema = z.object({
  jobId: z.string().uuid().optional(),
  jobRequirements: z
    .object({
      stack: z.array(z.string()).default([]),
      seniority: z.enum(['junior', 'semi', 'senior', 'lead']).default('semi'),
      yearsOfExperience: z.number().int().min(0).max(40).default(3),
      responsibilities: z.array(z.string()).default([]),
      niceToHave: z.array(z.string()).default([]),
      language: z.string().default('es'),
    })
    .optional(),
  candidateName: z.string().default('Candidato'),
  interviewHistory: z
    .array(
      z.object({
        q: z.string(),
        a: z.string(),
        score: z.number().optional(),
      })
    )
    .default([]),
  lastQuestion: z.string().default(''),
  lastAnswerTranscript: z.string().default(''),
  elapsedSec: z.number().int().min(0).default(0),
});

export async function leiaRoutes(app: FastifyInstance) {
  app.post('/api/leia/evaluate', async (req, reply) => {
    const parsed = EvaluateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.flatten() });
    }

    const db = await getDb();
    let job =
      parsed.data.jobId && (await db.getJob(parsed.data.jobId))
        ? await db.getJob(parsed.data.jobId)
        : null;
    if (!job) {
      const reqs = parsed.data.jobRequirements ?? {
        stack: [],
        seniority: 'semi' as const,
        yearsOfExperience: 3,
        responsibilities: [],
        niceToHave: [],
        language: 'es',
      };
      job = {
        id: 'ad-hoc',
        sourceLink: '',
        title: 'Entrevista ad-hoc',
        company: '',
        description: '',
        requirements: reqs,
        preferences: {
          durationMinutes: 20,
          dimensionsToCover: [
            'comunicacion',
            'tecnicos',
            'experiencia',
            'resolucion',
            'actitud',
            'trabajoEquipo',
          ],
          toneOfVoice: 'cercano',
          generateReport1: false,
          generateReport2: false,
        },
        rawText: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    const turnIndex = parsed.data.interviewHistory.length;
    const leia = getLeia();
    const result = await leia.evaluate({
      job: job!,
      candidateName: parsed.data.candidateName,
      history: parsed.data.interviewHistory.map((h, i) => ({
        id: `h${i}`,
        interviewId: 'ad-hoc',
        index: i,
        question: h.q,
        questionAt: new Date().toISOString(),
        answerTranscript: h.a,
        durationSec: 1,
      })),
      lastQuestion: parsed.data.lastQuestion,
      lastAnswer: parsed.data.lastAnswerTranscript,
      turnIndex,
      elapsedSec: parsed.data.elapsedSec,
    });
    return result;
  });

  // Alias del endpoint anterior: cuando solo querés la siguiente pregunta,
  // sin guardar evaluación. Devuelve { nextQuestion, shouldFinish }.
  app.post('/api/leia/next-question', async (req, reply) => {
    const parsed = EvaluateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.flatten() });
    }
    const inner = await app.inject({
      method: 'POST',
      url: '/api/leia/evaluate',
      payload: parsed.data,
      headers: { authorization: req.headers.authorization ?? '' },
    });
    const body = inner.json();
    return reply.code(inner.statusCode).send({
      nextQuestion: body.nextQuestion,
      shouldFinish: body.shouldFinish,
    });
  });
}
