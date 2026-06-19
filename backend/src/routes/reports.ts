import type { FastifyInstance } from 'fastify';
import { getDb } from '../db';

export async function reportsRoutes(app: FastifyInstance) {
  app.get('/api/reports/:interviewId/:kind', async (req, reply) => {
    const { interviewId, kind } = req.params as { interviewId: string; kind: string };
    const k = parseInt(kind, 10);
    if (k !== 1 && k !== 2) return reply.code(400).send({ error: 'invalid_kind' });
    const db = await getDb();
    const report = await db.getReport(interviewId, k as 1 | 2);
    if (!report) return reply.code(404).send({ error: 'report_not_found' });
    const [interview, candidate, job, evaluations, turns, transcripts] = await Promise.all([
      db.getInterview(interviewId),
      report ? db.getCandidate(report.candidateId) : Promise.resolve(null),
      report ? db.getJob(report.jobId) : Promise.resolve(null),
      db.listEvaluations(interviewId),
      db.listTurns(interviewId),
      db.listTranscripts(interviewId),
    ]);
    return { report, interview, candidate, job, evaluations, turns, transcripts };
  });

  app.get('/api/reports/by-interview/:interviewId', async (req, reply) => {
    const db = await getDb();
    const { interviewId } = req.params as { interviewId: string };
    const reports = await db.listReports(interviewId);
    if (reports.length === 0) return reply.code(404).send({ error: 'reports_not_found' });
    return { data: reports };
  });
}
