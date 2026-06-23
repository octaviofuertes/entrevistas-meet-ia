import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { config } from '../config';
import { getDb } from '../db';
import { getEngine, disposeEngine } from '../services/interview/engine';
import type { Interview, TTSDriver } from '../types';

const InterviewTtsDriverSchema = z.enum(['gemini', 'edge']);

const CreateInterviewSchema = z.object({
  jobId: z.string().uuid(),
  candidateId: z.string().uuid(),
  meetUrl: z.string().url(),
  scheduledAt: z.string().datetime().optional(),
  ttsDriver: InterviewTtsDriverSchema.optional(),
});

const UpdateInterviewTtsSchema = z.object({
  ttsDriver: InterviewTtsDriverSchema,
});

const StartInterviewSchema = z.object({
  ttsDriver: InterviewTtsDriverSchema.optional(),
});

export async function interviewsRoutes(app: FastifyInstance) {
  app.get('/api/interviews', async (req) => {
    const db = await getDb();
    const { status, candidateId, jobId } = req.query as {
      status?: string;
      candidateId?: string;
      jobId?: string;
    };
    return { data: await db.listInterviews({ status, candidateId, jobId }) };
  });

  app.get('/api/interviews/:id', async (req, reply) => {
    const db = await getDb();
    const { id } = req.params as { id: string };
    const interview = await db.getInterview(id);
    if (!interview) return reply.code(404).send({ error: 'interview_not_found' });

    const [job, candidate, turns, evaluations, transcripts, reports] = await Promise.all([
      db.getJob(interview.jobId),
      db.getCandidate(interview.candidateId),
      db.listTurns(id),
      db.listEvaluations(id),
      db.listTranscripts(id),
      db.listReports(id),
    ]);

    return {
      ...interview,
      job,
      candidate,
      turns,
      evaluations,
      transcripts,
      reports,
    };
  });

  app.post('/api/interviews', async (req, reply) => {
    const parsed = CreateInterviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.flatten() });
    }

    const db = await getDb();
    const job = await db.getJob(parsed.data.jobId);
    if (!job) return reply.code(404).send({ error: 'job_not_found' });
    const candidate = await db.getCandidate(parsed.data.candidateId);
    if (!candidate) return reply.code(404).send({ error: 'candidate_not_found' });

    const now = new Date().toISOString();
    const interview: Interview = {
      id: uuid(),
      jobId: parsed.data.jobId,
      candidateId: parsed.data.candidateId,
      status: 'agendada',
      meetUrl: parsed.data.meetUrl,
      ttsDriver: parsed.data.ttsDriver ?? defaultInterviewTtsDriver(),
      recallBotId: null,
      scheduledAt: parsed.data.scheduledAt ?? now,
      createdAt: now,
      updatedAt: now,
    };
    await db.createInterview(interview);
    return reply.code(201).send(interview);
  });

  app.patch('/api/interviews/:id/tts', async (req, reply) => {
    const parsed = UpdateInterviewTtsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.flatten() });
    }

    const db = await getDb();
    const { id } = req.params as { id: string };
    const interview = await db.getInterview(id);
    if (!interview) return reply.code(404).send({ error: 'interview_not_found' });
    if (interview.status !== 'agendada') {
      return reply.code(409).send({ error: 'interview_already_started' });
    }

    const updated = await db.updateInterview(id, { ttsDriver: parsed.data.ttsDriver });
    return { ok: true, interview: updated };
  });

  app.post('/api/interviews/:id/start', async (req, reply) => {
    const parsed = StartInterviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.flatten() });
    }

    const db = await getDb();
    const { id } = req.params as { id: string };
    const interview = await db.getInterview(id);
    if (!interview) return reply.code(404).send({ error: 'interview_not_found' });
    if (parsed.data.ttsDriver && interview.status === 'agendada') {
      await db.updateInterview(id, { ttsDriver: parsed.data.ttsDriver });
    }

    disposeEngine(id);
    const engine = getEngine(db, id);
    try {
      await engine.start();
    } catch (err: any) {
      return reply.code(500).send({ error: 'start_failed', message: err?.message });
    }
    return { ok: true, interviewId: id };
  });

  app.post('/api/interviews/:id/finalize', async (req, reply) => {
    const db = await getDb();
    const { id } = req.params as { id: string };
    const interview = await db.getInterview(id);
    if (!interview) return reply.code(404).send({ error: 'interview_not_found' });

    const body = (req.body ?? {}) as { behavior?: any };
    if (body.behavior && typeof body.behavior === 'object') {
      await db.updateInterview(id, { behavioralAnalysis: body.behavior });
    }

    const engine = getEngine(db, id);
    const reports = await engine.stop('manual');
    return { ok: true, reports };
  });

  app.post('/api/interviews/:id/simulate-answer', async (req, reply) => {
    const Body = z.object({ text: z.string().min(1) });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.flatten() });
    }
    const db = await getDb();
    const { id } = req.params as { id: string };
    const interview = await db.getInterview(id);
    if (!interview) return reply.code(404).send({ error: 'interview_not_found' });

    const engine = getEngine(db, id);
    await engine.simulateCandidateAnswer(parsed.data.text);
    return { ok: true };
  });

  app.delete('/api/interviews/:id', async (req, reply) => {
    const db = await getDb();
    const { id } = req.params as { id: string };
    const ok = await db.deleteInterview(id);
    if (!ok) return reply.code(404).send({ error: 'interview_not_found' });
    return reply.code(204).send();
  });
}

function defaultInterviewTtsDriver(): Extract<TTSDriver, 'gemini' | 'edge'> {
  return config.TTS_DRIVER === 'edge' ? 'edge' : 'gemini';
}
