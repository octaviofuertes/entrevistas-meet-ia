import { config } from '../config';
import { logger } from '../logger';
import { MemoryDb } from './memory';
import { PostgresDb } from './postgres';
import type {
  Job,
  Company,
  Candidate,
  Application,
  CvScreening,
  Interview,
  InterviewTurn,
  TranscriptFragment,
  Evaluation,
  Report,
  ReportKind,
  AuditLog,
  UUID,
} from '../types';

export interface Database {
  init(): Promise<void>;

  // Companies
  listCompanies(): Promise<Company[]>;
  getCompany(id: UUID): Promise<Company | null>;
  createCompany(c: Company): Promise<Company>;
  updateCompany(id: UUID, patch: Partial<Company>): Promise<Company | null>;
  deleteCompany(id: UUID): Promise<boolean>;

  // Jobs
  listJobs(): Promise<Job[]>;
  getJob(id: UUID): Promise<Job | null>;
  createJob(j: Job): Promise<Job>;
  updateJob(id: UUID, patch: Partial<Job>): Promise<Job | null>;
  deleteJob(id: UUID): Promise<boolean>;

  // Candidates
  listCandidates(): Promise<Candidate[]>;
  getCandidate(id: UUID): Promise<Candidate | null>;
  getCandidateByEmail(email: string): Promise<Candidate | null>;
  createCandidate(c: Candidate): Promise<Candidate>;
  updateCandidate(id: UUID, patch: Partial<Candidate>): Promise<Candidate | null>;
  deleteCandidate(id: UUID): Promise<boolean>;

  // Applications (RF-01/RF-04): vinculan un candidato a una vacante + match
  listApplications(filter?: { jobId?: UUID; candidateId?: UUID }): Promise<Application[]>;
  getApplication(jobId: UUID, candidateId: UUID): Promise<Application | null>;
  createApplication(a: Application): Promise<Application>;
  deleteApplication(id: UUID): Promise<boolean>;

  // Interviews
  listInterviews(filter?: {
    status?: string;
    jobId?: UUID;
    candidateId?: UUID;
  }): Promise<Interview[]>;
  getInterview(id: UUID): Promise<Interview | null>;
  createInterview(i: Interview): Promise<Interview>;
  updateInterview(id: UUID, patch: Partial<Interview>): Promise<Interview | null>;
  deleteInterview(id: UUID): Promise<boolean>;

  // Turns
  listTurns(interviewId: UUID): Promise<InterviewTurn[]>;
  createTurn(t: InterviewTurn): Promise<InterviewTurn>;
  updateTurn(id: UUID, patch: Partial<InterviewTurn>): Promise<InterviewTurn | null>;

  // Transcripts
  listTranscripts(interviewId: UUID): Promise<TranscriptFragment[]>;
  appendTranscript(t: TranscriptFragment): Promise<TranscriptFragment>;

  // Evaluations
  listEvaluations(interviewId: UUID): Promise<Evaluation[]>;
  createEvaluation(e: Evaluation): Promise<Evaluation>;

  // Reports
  getReport(interviewId: UUID, kind: ReportKind): Promise<Report | null>;
  listReports(interviewId: UUID): Promise<Report[]>;
  createReport(r: Report): Promise<Report>;

  // CV Screenings
  listCvScreenings(jobId: UUID): Promise<CvScreening[]>;
  createCvScreening(s: CvScreening): Promise<CvScreening>;
  deleteCvScreening(id: UUID): Promise<boolean>;

  // Audit
  log(entry: AuditLog): Promise<void>;
}

let instance: Database | null = null;

export async function getDb(): Promise<Database> {
  if (instance) return instance;

  if (config.DATABASE_DRIVER === 'postgres') {
    logger.info({ driver: 'postgres', url: maskUrl(config.DATABASE_URL) }, 'Inicializando PostgreSQL');
    instance = new PostgresDb(config.DATABASE_URL);
  } else {
    logger.info({ driver: 'memory' }, 'Inicializando DB en memoria');
    instance = new MemoryDb();
  }

  await instance.init();
  return instance;
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return 'url-invalida';
  }
}
