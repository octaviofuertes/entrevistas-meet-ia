export type UUID = string;
export type ISODate = string;
export type TTSDriver = 'mock' | 'elevenlabs' | 'gemini' | 'edge';

// ============================================================
// JOBS - puestos generados a partir de un link
// ============================================================
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
  /** Análisis de comportamiento por cámara (Etapa 2). Default: activado. */
  behavioralAnalysisEnabled?: boolean;
}

export type JobModality = 'presencial' | 'hibrido' | 'remoto';
export type JobHiringStatus = 'abierto' | 'pausado' | 'cerrado';

export interface Job {
  id: UUID;
  sourceLink: string;
  title: string;
  company: string;
  description: string;
  requirements: JobRequirements;
  preferences: JobPreferences;
  rawText?: string | null;
  /** Fecha de publicación de la búsqueda. */
  publishedAt?: ISODate | null;
  location?: string | null;
  salary?: string | null;
  vacancies?: number | null;
  modality?: JobModality | null;
  hiringStatus?: JobHiringStatus | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

// ============================================================
// CANDIDATES
// ============================================================
export interface Candidate {
  id: UUID;
  email: string;
  name: string;
  phone?: string | null;
  cvUrl?: string | null;
  notes?: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

// ============================================================
// BEHAVIORAL ANALYSIS (observaciones por cámara)
// ============================================================
export interface BehavioralAnalysis {
  /** Duración total de la entrevista en segundos (referencia). */
  durationSec: number;
  /** Tiempo (s) con cámara prendida y cara detectada. */
  faceVisibleSec: number;
  /** Tiempo (s) con cámara apagada. */
  cameraOffSec: number;
  /** Tiempos (s) por estado de atención. */
  attentionSec: {
    attentive: number;
    reading: number;
    distracted: number;
    absent: number;
  };
  /** Cantidad de episodios de mirada baja prolongada. */
  readingEvents: number;
  /** Expresión dominante observada (la más frecuente). */
  dominantExpression: string;
  /** Distribución relativa de expresiones detectadas (0..1). */
  expressionDistribution: Record<string, number>;
  /** Comentarios extra capturados por el cliente. */
  notes?: string[];
}

// ============================================================
// INTERVIEWS
// ============================================================
export type InterviewStatus =
  | 'pendiente'
  | 'agendada'
  | 'en_curso'
  | 'completada'
  | 'cancelada'
  | 'error';

export type InterviewMode = 'meet' | 'browser';

export interface Interview {
  id: UUID;
  jobId: UUID;
  candidateId: UUID;
  status: InterviewStatus;
  mode?: InterviewMode | null;
  meetUrl: string;
  ttsDriver?: TTSDriver | null;
  recallBotId?: string | null;
  scheduledAt?: ISODate | null;
  startedAt?: ISODate | null;
  endedAt?: ISODate | null;
  durationSec?: number | null;
  behavioralAnalysis?: BehavioralAnalysis | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

// ============================================================
// INTERVIEW TURNS - cada par pregunta/respuesta
// ============================================================
export interface InterviewTurn {
  id: UUID;
  interviewId: UUID;
  index: number;
  question: string;
  questionAt: ISODate;
  answerTranscript: string;
  answerAt?: ISODate | null;
  durationSec: number;
  evaluationId?: UUID | null;
}

// ============================================================
// TRANSCRIPTS - captions nativos de Meet
// ============================================================
export interface TranscriptFragment {
  id: UUID;
  interviewId: UUID;
  speaker: 'bot' | 'candidate' | 'other';
  text: string;
  startMs: number;
  endMs: number;
  isFinal: boolean;
  receivedAt: ISODate;
}

// ============================================================
// EVALUATIONS - leIA evalúa cada turno con 6 dimensiones
// ============================================================
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

export interface Evaluation {
  id: UUID;
  interviewId: UUID;
  turnId: UUID;
  score: number;
  dimensions: DimensionScores;
  flags: string[];
  rationale: string;
  createdAt: ISODate;
}

// ============================================================
// REPORTS - dos reportes por entrevista (Informe 1 y 2)
// ============================================================
export type ReportKind = 1 | 2;

export interface Report1Payload {
  summary: string;
  highlights: string[];
  /** Momentos destacados de la conversación (citas o anécdotas concretas). */
  keyMoments?: string[];
  /** Temas / áreas que se llegaron a cubrir en la entrevista. */
  topicsCovered?: string[];
  /** Puntos de atención o señales que conviene revisar. */
  concerns?: string[];
  /** Observaciones sobre el comportamiento del candidato (lenguaje no verbal, atención). */
  behavioralObservations?: string[];
  /** Resumen del análisis por cámara, si estuvo disponible. */
  behavior?: BehavioralAnalysis | null;
  fullTranscript: Array<{
    speaker: 'bot' | 'candidate';
    text: string;
    atMs: number;
  }>;
  durationSec: number;
  language: string;
}

/** Distribución de sentimiento del candidato a lo largo de la entrevista (%). */
export interface SentimentDistribution {
  positive: number;
  neutral: number;
  negative: number;
  notApplicable: number;
}

/** Distribución de calidad de las respuestas del candidato (%). */
export interface QualityDistribution {
  excellent: number;
  good: number;
  fair: number;
  poor: number;
}

export interface Report2Payload {
  /** Resumen ejecutivo prolijo, 4-6 oraciones, lo primero que lee un reclutador. */
  executiveSummary: string;
  scoreTotal: number;
  dimensions: DimensionScores;
  stackScores: Record<string, number>;
  softskills: number;
  strengths: string[];
  weaknesses: string[];
  flags: string[];
  /** Analítica tipo dashboard: sentimiento del candidato por respuesta (%). */
  sentimentDistribution: SentimentDistribution;
  /** Analítica tipo dashboard: calidad de las respuestas (%). */
  qualityDistribution: QualityDistribution;
  /** Cantidad de respuestas (turnos) analizadas para las analíticas. */
  turnsAnalyzed: number;
  /** Observaciones de comportamiento que afectaron la evaluación. */
  behavioralObservations?: string[];
  /** Bandera: ¿hubo sospecha de lectura asistida durante la entrevista? */
  suspectedReading?: boolean;
  /** Datos crudos del análisis facial, si se capturaron. */
  behavior?: BehavioralAnalysis | null;
  recomendacion: 'avanzar' | 'segunda_instancia' | 'descartar';
  recomendacionReason: string;
}

export interface Report {
  id: UUID;
  interviewId: UUID;
  candidateId: UUID;
  jobId: UUID;
  kind: ReportKind;
  payload: Report1Payload | Report2Payload;
  createdAt: ISODate;
}

// ============================================================
// AUDIT
// ============================================================
export interface AuditLog {
  id: UUID;
  entity: string;
  entityId: UUID;
  action: string;
  actor: string;
  metadata?: Record<string, unknown>;
  timestamp: ISODate;
}

// ============================================================
// Helpers de tipo
// ============================================================
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
  tecnicos: 'Conocimientos técnicos',
  experiencia: 'Experiencia',
  resolucion: 'Resolución de problemas',
  actitud: 'Actitud',
  trabajoEquipo: 'Trabajo en equipo',
};
