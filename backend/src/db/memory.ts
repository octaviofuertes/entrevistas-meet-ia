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

export class MemoryDb implements Database {
  private jobs = new Map<UUID, Job>();
  private candidates = new Map<UUID, Candidate>();
  private interviews = new Map<UUID, Interview>();
  private turns = new Map<UUID, InterviewTurn>();
  private transcripts: TranscriptFragment[] = [];
  private evaluations = new Map<UUID, Evaluation>();
  private reports = new Map<UUID, Report>();
  private auditLog: AuditLog[] = [];

  async init() {
    const { seedDb } = await import('./seed');
    await seedDb(this);
  }

  // -------------------- Jobs --------------------
  async listJobs() {
    return Array.from(this.jobs.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }

  async getJob(id: UUID) {
    return this.jobs.get(id) ?? null;
  }

  async createJob(j: Job) {
    this.jobs.set(j.id, j);
    return j;
  }

  async updateJob(id: UUID, patch: Partial<Job>) {
    const existing = this.jobs.get(id);
    if (!existing) return null;
    const updated: Job = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.jobs.set(id, updated);
    return updated;
  }

  async deleteJob(id: UUID) {
    return this.jobs.delete(id);
  }

  // -------------------- Candidates --------------------
  async listCandidates() {
    return Array.from(this.candidates.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }

  async getCandidate(id: UUID) {
    return this.candidates.get(id) ?? null;
  }

  async getCandidateByEmail(email: string) {
    for (const c of this.candidates.values()) {
      if (c.email.toLowerCase() === email.toLowerCase()) return c;
    }
    return null;
  }

  async createCandidate(c: Candidate) {
    this.candidates.set(c.id, c);
    return c;
  }

  async updateCandidate(id: UUID, patch: Partial<Candidate>) {
    const existing = this.candidates.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.candidates.set(id, updated);
    return updated;
  }

  async deleteCandidate(id: UUID) {
    return this.candidates.delete(id);
  }

  // -------------------- Interviews --------------------
  async listInterviews(filter?: { status?: string; jobId?: UUID; candidateId?: UUID }) {
    let arr = Array.from(this.interviews.values());
    if (filter?.status) arr = arr.filter((i) => i.status === filter.status);
    if (filter?.jobId) arr = arr.filter((i) => i.jobId === filter.jobId);
    if (filter?.candidateId) arr = arr.filter((i) => i.candidateId === filter.candidateId);
    return arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getInterview(id: UUID) {
    return this.interviews.get(id) ?? null;
  }

  async createInterview(i: Interview) {
    this.interviews.set(i.id, i);
    return i;
  }

  async updateInterview(id: UUID, patch: Partial<Interview>) {
    const existing = this.interviews.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.interviews.set(id, updated);
    return updated;
  }

  async deleteInterview(id: UUID) {
    return this.interviews.delete(id);
  }

  // -------------------- Turns --------------------
  async listTurns(interviewId: UUID) {
    return Array.from(this.turns.values())
      .filter((t) => t.interviewId === interviewId)
      .sort((a, b) => a.index - b.index);
  }

  async createTurn(t: InterviewTurn) {
    this.turns.set(t.id, t);
    return t;
  }

  async updateTurn(id: UUID, patch: Partial<InterviewTurn>) {
    const existing = this.turns.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    this.turns.set(id, updated);
    return updated;
  }

  // -------------------- Transcripts --------------------
  async listTranscripts(interviewId: UUID) {
    return this.transcripts
      .filter((t) => t.interviewId === interviewId)
      .sort((a, b) => a.startMs - b.startMs);
  }

  async appendTranscript(t: TranscriptFragment) {
    this.transcripts.push(t);
    if (this.transcripts.length > 100_000) this.transcripts.shift();
    return t;
  }

  // -------------------- Evaluations --------------------
  async listEvaluations(interviewId: UUID) {
    return Array.from(this.evaluations.values())
      .filter((e) => e.interviewId === interviewId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createEvaluation(e: Evaluation) {
    this.evaluations.set(e.id, e);
    return e;
  }

  // -------------------- Reports --------------------
  async getReport(interviewId: UUID, kind: ReportKind) {
    for (const r of this.reports.values()) {
      if (r.interviewId === interviewId && r.kind === kind) return r;
    }
    return null;
  }

  async listReports(interviewId: UUID) {
    return Array.from(this.reports.values())
      .filter((r) => r.interviewId === interviewId)
      .sort((a, b) => a.kind - b.kind);
  }

  async createReport(r: Report) {
    // Reemplaza si ya existía el mismo (interviewId, kind)
    for (const [id, existing] of this.reports.entries()) {
      if (existing.interviewId === r.interviewId && existing.kind === r.kind) {
        this.reports.delete(id);
      }
    }
    this.reports.set(r.id, r);
    return r;
  }

  // -------------------- Audit --------------------
  async log(entry: AuditLog) {
    this.auditLog.push(entry);
    if (this.auditLog.length > 10_000) this.auditLog.shift();
  }
}
