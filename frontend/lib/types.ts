export type UUID = string;

export type InterviewDimension =
  | 'comunicacion'
  | 'tecnicos'
  | 'experiencia'
  | 'resolucion'
  | 'actitud'
  | 'trabajoEquipo';

export interface DimensionScores {
  comunicacion: number;
  tecnicos: number;
  experiencia: number;
  resolucion: number;
  actitud: number;
  trabajoEquipo: number;
}

export const ALL_DIMENSIONS: InterviewDimension[] = [
  'comunicacion',
  'tecnicos',
  'experiencia',
  'resolucion',
  'actitud',
  'trabajoEquipo',
];

export const DIMENSION_LABELS: Record<InterviewDimension, string> = {
  comunicacion: 'Comunicación',
  tecnicos: 'Técnicos',
  experiencia: 'Experiencia',
  resolucion: 'Resolución',
  actitud: 'Actitud',
  trabajoEquipo: 'Trabajo en equipo',
};

export interface JobRequirements {
  stack: string[];
  seniority: 'junior' | 'semi' | 'senior' | 'lead';
  yearsOfExperience: number;
  responsibilities: string[];
  niceToHave: string[];
  language: string;
}

export interface JobPreferences {
  durationMinutes: number;
  dimensionsToCover: InterviewDimension[];
  toneOfVoice: 'formal' | 'cercano' | 'tecnico';
  generateReport1: boolean;
  generateReport2: boolean;
}

export interface Job {
  id: UUID;
  sourceLink: string;
  title: string;
  company: string;
  description: string;
  requirements: JobRequirements;
  preferences: JobPreferences;
  rawText?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Candidate {
  id: UUID;
  email: string;
  name: string;
  phone?: string | null;
  cvUrl?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type InterviewStatus =
  | 'pendiente'
  | 'agendada'
  | 'en_curso'
  | 'completada'
  | 'cancelada'
  | 'error';

export interface Interview {
  id: UUID;
  jobId: UUID;
  candidateId: UUID;
  status: InterviewStatus;
  meetUrl: string;
  recallBotId?: string | null;
  scheduledAt?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  durationSec?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface InterviewTurn {
  id: UUID;
  interviewId: UUID;
  index: number;
  question: string;
  questionAt: string;
  answerTranscript: string;
  answerAt?: string | null;
  durationSec: number;
  evaluationId?: UUID | null;
}

export interface TranscriptFragment {
  id: UUID;
  interviewId: UUID;
  speaker: 'bot' | 'candidate' | 'other';
  text: string;
  startMs: number;
  endMs: number;
  isFinal: boolean;
  receivedAt: string;
}

export interface Evaluation {
  id: UUID;
  interviewId: UUID;
  turnId: UUID;
  score: number;
  dimensions: DimensionScores;
  flags: string[];
  rationale: string;
  createdAt: string;
}

export interface BehavioralAnalysis {
  durationSec: number;
  faceVisibleSec: number;
  cameraOffSec: number;
  attentionSec: { attentive: number; reading: number; distracted: number; absent: number };
  readingEvents: number;
  dominantExpression: string;
  expressionDistribution: Record<string, number>;
}

export interface Report1Payload {
  summary: string;
  highlights: string[];
  behavioralObservations?: string[];
  behavior?: BehavioralAnalysis | null;
  fullTranscript: Array<{ speaker: 'bot' | 'candidate'; text: string; atMs: number }>;
  durationSec: number;
  language: string;
}

export interface Report2Payload {
  scoreTotal: number;
  dimensions: DimensionScores;
  stackScores: Record<string, number>;
  softskills: number;
  strengths: string[];
  weaknesses: string[];
  flags: string[];
  behavioralObservations?: string[];
  suspectedReading?: boolean;
  behavior?: BehavioralAnalysis | null;
  recomendacion: 'avanzar' | 'segunda_instancia' | 'descartar';
  recomendacionReason: string;
}

export type ReportKind = 1 | 2;

export interface Report {
  id: UUID;
  interviewId: UUID;
  candidateId: UUID;
  jobId: UUID;
  kind: ReportKind;
  payload: Report1Payload | Report2Payload;
  createdAt: string;
}

export interface InterviewDetail extends Interview {
  job: Job | null;
  candidate: Candidate | null;
  turns: InterviewTurn[];
  evaluations: Evaluation[];
  transcripts: TranscriptFragment[];
  reports: Report[];
}
