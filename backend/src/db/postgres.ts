import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import type { Database } from './index';
import type {
  Job,
  Candidate,
  Interview,
  InterviewTurn,
  TranscriptFragment,
  Evaluation,
  Report,
  ReportKind,
  AuditLog,
  UUID,
} from '../types';

export class PostgresDb implements Database {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10 });
  }

  async init() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf-8');
      await this.pool.query(sql);
    }
  }

  // -------------------- Jobs --------------------
  async listJobs() {
    const { rows } = await this.pool.query(`SELECT * FROM jobs ORDER BY created_at DESC`);
    return rows.map(rowToJob);
  }

  async getJob(id: UUID) {
    const { rows } = await this.pool.query(`SELECT * FROM jobs WHERE id=$1`, [id]);
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  async createJob(j: Job) {
    await this.pool.query(
      `INSERT INTO jobs (id, source_link, title, company, description, requirements, preferences, raw_text, published_at, location, salary, vacancies, modality, hiring_status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        j.id,
        j.sourceLink,
        j.title,
        j.company,
        j.description,
        JSON.stringify(j.requirements),
        JSON.stringify(j.preferences),
        j.rawText ?? null,
        j.publishedAt ?? null,
        j.location ?? null,
        j.salary ?? null,
        j.vacancies ?? null,
        j.modality ?? null,
        j.hiringStatus ?? 'abierto',
        j.createdAt,
        j.updatedAt,
      ]
    );
    return j;
  }

  async updateJob(id: UUID, patch: Partial<Job>) {
    const existing = await this.getJob(id);
    if (!existing) return null;
    const merged: Job = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await this.pool.query(
      `UPDATE jobs SET source_link=$2, title=$3, company=$4, description=$5, requirements=$6, preferences=$7, raw_text=$8, published_at=$9, location=$10, salary=$11, vacancies=$12, modality=$13, hiring_status=$14, updated_at=$15 WHERE id=$1`,
      [
        merged.id,
        merged.sourceLink,
        merged.title,
        merged.company,
        merged.description,
        JSON.stringify(merged.requirements),
        JSON.stringify(merged.preferences),
        merged.rawText ?? null,
        merged.publishedAt ?? null,
        merged.location ?? null,
        merged.salary ?? null,
        merged.vacancies ?? null,
        merged.modality ?? null,
        merged.hiringStatus ?? 'abierto',
        merged.updatedAt,
      ]
    );
    return merged;
  }

  async deleteJob(id: UUID) {
    const r = await this.pool.query(`DELETE FROM jobs WHERE id=$1`, [id]);
    return (r.rowCount ?? 0) > 0;
  }

  // -------------------- Candidates --------------------
  async listCandidates() {
    const { rows } = await this.pool.query(
      `SELECT * FROM candidates ORDER BY created_at DESC`
    );
    return rows.map(rowToCandidate);
  }

  async getCandidate(id: UUID) {
    const { rows } = await this.pool.query(`SELECT * FROM candidates WHERE id=$1`, [id]);
    return rows[0] ? rowToCandidate(rows[0]) : null;
  }

  async getCandidateByEmail(email: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM candidates WHERE LOWER(email) = LOWER($1)`,
      [email]
    );
    return rows[0] ? rowToCandidate(rows[0]) : null;
  }

  async createCandidate(c: Candidate) {
    await this.pool.query(
      `INSERT INTO candidates (id, email, name, phone, cv_url, notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [c.id, c.email, c.name, c.phone ?? null, c.cvUrl ?? null, c.notes ?? null, c.createdAt, c.updatedAt]
    );
    return c;
  }

  async updateCandidate(id: UUID, patch: Partial<Candidate>) {
    const existing = await this.getCandidate(id);
    if (!existing) return null;
    const merged: Candidate = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await this.pool.query(
      `UPDATE candidates SET email=$2, name=$3, phone=$4, cv_url=$5, notes=$6, updated_at=$7 WHERE id=$1`,
      [merged.id, merged.email, merged.name, merged.phone ?? null, merged.cvUrl ?? null, merged.notes ?? null, merged.updatedAt]
    );
    return merged;
  }

  async deleteCandidate(id: UUID) {
    const r = await this.pool.query(`DELETE FROM candidates WHERE id=$1`, [id]);
    return (r.rowCount ?? 0) > 0;
  }

  // -------------------- Interviews --------------------
  async listInterviews(filter?: { status?: string; jobId?: UUID; candidateId?: UUID }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter?.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    if (filter?.jobId) {
      params.push(filter.jobId);
      where.push(`job_id = $${params.length}`);
    }
    if (filter?.candidateId) {
      params.push(filter.candidateId);
      where.push(`candidate_id = $${params.length}`);
    }
    const sql = `SELECT * FROM interviews ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`;
    const { rows } = await this.pool.query(sql, params);
    return rows.map(rowToInterview);
  }

  async getInterview(id: UUID) {
    const { rows } = await this.pool.query(`SELECT * FROM interviews WHERE id=$1`, [id]);
    return rows[0] ? rowToInterview(rows[0]) : null;
  }

  async createInterview(i: Interview) {
    await this.pool.query(
      `INSERT INTO interviews (id, job_id, candidate_id, status, meet_url, tts_driver, mode, recall_bot_id, scheduled_at, started_at, ended_at, duration_sec, behavioral_analysis, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        i.id,
        i.jobId,
        i.candidateId,
        i.status,
        i.meetUrl,
        normalizeTtsDriver(i.ttsDriver),
        i.mode ?? 'meet',
        i.recallBotId ?? null,
        i.scheduledAt ?? null,
        i.startedAt ?? null,
        i.endedAt ?? null,
        i.durationSec ?? null,
        i.behavioralAnalysis ? JSON.stringify(i.behavioralAnalysis) : null,
        i.createdAt,
        i.updatedAt,
      ]
    );
    return i;
  }

  async updateInterview(id: UUID, patch: Partial<Interview>) {
    const existing = await this.getInterview(id);
    if (!existing) return null;
    const merged: Interview = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await this.pool.query(
      `UPDATE interviews SET job_id=$2, candidate_id=$3, status=$4, meet_url=$5, tts_driver=$6, mode=$7, recall_bot_id=$8, scheduled_at=$9, started_at=$10, ended_at=$11, duration_sec=$12, behavioral_analysis=$13, updated_at=$14 WHERE id=$1`,
      [
        merged.id,
        merged.jobId,
        merged.candidateId,
        merged.status,
        merged.meetUrl,
        normalizeTtsDriver(merged.ttsDriver),
        merged.mode ?? 'meet',
        merged.recallBotId ?? null,
        merged.scheduledAt ?? null,
        merged.startedAt ?? null,
        merged.endedAt ?? null,
        merged.durationSec ?? null,
        merged.behavioralAnalysis ? JSON.stringify(merged.behavioralAnalysis) : null,
        merged.updatedAt,
      ]
    );
    return merged;
  }

  async deleteInterview(id: UUID) {
    const r = await this.pool.query(`DELETE FROM interviews WHERE id=$1`, [id]);
    return (r.rowCount ?? 0) > 0;
  }

  // -------------------- Turns --------------------
  async listTurns(interviewId: UUID) {
    const { rows } = await this.pool.query(
      `SELECT * FROM interview_turns WHERE interview_id=$1 ORDER BY "index"`,
      [interviewId]
    );
    return rows.map(rowToTurn);
  }

  async createTurn(t: InterviewTurn) {
    await this.pool.query(
      `INSERT INTO interview_turns (id, interview_id, "index", question, question_at, answer_transcript, answer_at, duration_sec, evaluation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        t.id,
        t.interviewId,
        t.index,
        t.question,
        t.questionAt,
        t.answerTranscript,
        t.answerAt ?? null,
        t.durationSec,
        t.evaluationId ?? null,
      ]
    );
    return t;
  }

  async updateTurn(id: UUID, patch: Partial<InterviewTurn>) {
    const { rows: existingRows } = await this.pool.query(
      `SELECT * FROM interview_turns WHERE id=$1`,
      [id]
    );
    if (!existingRows[0]) return null;
    const existing = rowToTurn(existingRows[0]);
    const merged: InterviewTurn = { ...existing, ...patch };
    await this.pool.query(
      `UPDATE interview_turns SET answer_transcript=$2, answer_at=$3, duration_sec=$4, evaluation_id=$5 WHERE id=$1`,
      [
        merged.id,
        merged.answerTranscript,
        merged.answerAt ?? null,
        merged.durationSec,
        merged.evaluationId ?? null,
      ]
    );
    return merged;
  }

  // -------------------- Transcripts --------------------
  async listTranscripts(interviewId: UUID) {
    const { rows } = await this.pool.query(
      `SELECT * FROM transcripts WHERE interview_id=$1 ORDER BY start_ms`,
      [interviewId]
    );
    return rows.map(rowToTranscript);
  }

  async appendTranscript(t: TranscriptFragment) {
    await this.pool.query(
      `INSERT INTO transcripts (id, interview_id, speaker, text, start_ms, end_ms, is_final, received_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [t.id, t.interviewId, t.speaker, t.text, t.startMs, t.endMs, t.isFinal, t.receivedAt]
    );
    return t;
  }

  // -------------------- Evaluations --------------------
  async listEvaluations(interviewId: UUID) {
    const { rows } = await this.pool.query(
      `SELECT * FROM evaluations WHERE interview_id=$1 ORDER BY created_at`,
      [interviewId]
    );
    return rows.map(rowToEvaluation);
  }

  async createEvaluation(e: Evaluation) {
    await this.pool.query(
      `INSERT INTO evaluations (id, interview_id, turn_id, score, dimensions, flags, rationale, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        e.id,
        e.interviewId,
        e.turnId,
        e.score,
        JSON.stringify(e.dimensions),
        JSON.stringify(e.flags),
        e.rationale,
        e.createdAt,
      ]
    );
    return e;
  }

  // -------------------- Reports --------------------
  async getReport(interviewId: UUID, kind: ReportKind) {
    const { rows } = await this.pool.query(
      `SELECT * FROM reports WHERE interview_id=$1 AND kind=$2`,
      [interviewId, kind]
    );
    return rows[0] ? rowToReport(rows[0]) : null;
  }

  async listReports(interviewId: UUID) {
    const { rows } = await this.pool.query(
      `SELECT * FROM reports WHERE interview_id=$1 ORDER BY kind`,
      [interviewId]
    );
    return rows.map(rowToReport);
  }

  async createReport(r: Report) {
    await this.pool.query(
      `INSERT INTO reports (id, interview_id, candidate_id, job_id, kind, payload, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (interview_id, kind) DO UPDATE
         SET payload = EXCLUDED.payload, created_at = EXCLUDED.created_at`,
      [r.id, r.interviewId, r.candidateId, r.jobId, r.kind, JSON.stringify(r.payload), r.createdAt]
    );
    return r;
  }

  // -------------------- Audit --------------------
  async log(entry: AuditLog) {
    await this.pool.query(
      `INSERT INTO audit_logs (id, entity, entity_id, action, actor, metadata, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [entry.id, entry.entity, entry.entityId, entry.action, entry.actor, entry.metadata ?? null, entry.timestamp]
    );
  }
}

// -------------------- Mappers --------------------
function rowToJob(r: any): Job {
  return {
    id: r.id,
    sourceLink: r.source_link,
    title: r.title,
    company: r.company,
    description: r.description,
    requirements: r.requirements,
    preferences: r.preferences,
    rawText: r.raw_text,
    publishedAt: r.published_at?.toISOString() ?? null,
    location: r.location,
    salary: r.salary,
    vacancies: r.vacancies,
    modality: r.modality,
    hiringStatus: r.hiring_status,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

function rowToCandidate(r: any): Candidate {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    phone: r.phone,
    cvUrl: r.cv_url,
    notes: r.notes,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

function rowToInterview(r: any): Interview {
  return {
    id: r.id,
    jobId: r.job_id,
    candidateId: r.candidate_id,
    status: r.status,
    meetUrl: r.meet_url,
    ttsDriver: normalizeTtsDriver(r.tts_driver),
    mode: r.mode ?? 'meet',
    recallBotId: r.recall_bot_id,
    scheduledAt: r.scheduled_at?.toISOString() ?? null,
    startedAt: r.started_at?.toISOString() ?? null,
    endedAt: r.ended_at?.toISOString() ?? null,
    durationSec: r.duration_sec,
    behavioralAnalysis: r.behavioral_analysis ?? null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

function normalizeTtsDriver(value: unknown): 'gemini' | 'edge' {
  return value === 'edge' ? 'edge' : 'gemini';
}

function rowToTurn(r: any): InterviewTurn {
  return {
    id: r.id,
    interviewId: r.interview_id,
    index: r.index,
    question: r.question,
    questionAt: r.question_at.toISOString(),
    answerTranscript: r.answer_transcript,
    answerAt: r.answer_at?.toISOString() ?? null,
    durationSec: r.duration_sec,
    evaluationId: r.evaluation_id,
  };
}

function rowToTranscript(r: any): TranscriptFragment {
  return {
    id: r.id,
    interviewId: r.interview_id,
    speaker: r.speaker,
    text: r.text,
    // pg devuelve BIGINT como string por defecto (evita pérdida de precisión);
    // epoch-ms cabe cómodo en Number.MAX_SAFE_INTEGER, así que convertimos.
    startMs: Number(r.start_ms),
    endMs: Number(r.end_ms),
    isFinal: r.is_final,
    receivedAt: r.received_at.toISOString(),
  };
}

function rowToEvaluation(r: any): Evaluation {
  return {
    id: r.id,
    interviewId: r.interview_id,
    turnId: r.turn_id,
    score: parseFloat(r.score),
    dimensions: r.dimensions,
    flags: r.flags ?? [],
    rationale: r.rationale,
    createdAt: r.created_at.toISOString(),
  };
}

function rowToReport(r: any): Report {
  return {
    id: r.id,
    interviewId: r.interview_id,
    candidateId: r.candidate_id,
    jobId: r.job_id,
    kind: r.kind,
    payload: r.payload,
    createdAt: r.created_at.toISOString(),
  };
}
