export type UUID = string;
export type ISODate = string;
export type TTSDriver = 'mock' | 'elevenlabs' | 'gemini' | 'edge';
export type CvRecommendation = 'contratar' | 'entrevistar' | 'descartar';

// ============================================================
// COMPANIES — perfil de empresa para los puestos
// ============================================================
export type CompanyType = 'privada' | 'publica' | 'mixta';

export interface Company {
  id: UUID;
  name: string;
  logoUrl?: string | null;
  country?: string | null;
  cuit?: string | null;
  mission?: string | null;
  vision?: string | null;
  type?: CompanyType | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

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

// ============================================================
// RF-02 — Banco de preguntas generado automáticamente por IA
// ============================================================
/**
 * Tipos de pregunta que la IA debe generar al guardar el puesto:
 *  - tecnica:     valida el stack solicitado (React, TypeScript, …)
 *  - situacional: comportamental, basada en las responsabilidades del puesto
 *  - descarte:    verifica requisitos excluyentes (radicación, pretensión salarial)
 */
export type JobQuestionKind = 'tecnica' | 'situacional' | 'descarte';

export interface JobQuestion {
  id: UUID;
  text: string;
  kind: JobQuestionKind;
  /** 'ia' = generada automáticamente; 'manual' = editada/agregada por el reclutador. */
  source: 'ia' | 'manual';
}

export type JobModality = 'presencial' | 'hibrido' | 'remoto';
export type JobHiringStatus = 'abierto' | 'pausado' | 'cerrado';

export interface Job {
  id: UUID;
  sourceLink: string;
  title: string;
  company: string;
  companyId?: UUID | null;
  description: string;
  requirements: JobRequirements;
  preferences: JobPreferences;
  /** RF-02: banco de 5-10 preguntas generado por IA al guardar el puesto. */
  questions: JobQuestion[];
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
// CV SCREENINGS — evaluación de CVs contra un puesto
// ============================================================
export interface CvScreening {
  id: UUID;
  jobId: UUID;
  fileName: string;
  score: number;
  recommendation: CvRecommendation;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  createdAt: ISODate;
}

// ============================================================
// CANDIDATES
// ============================================================
/** RF-03 — Nivel de idioma según marco común europeo (o nativo). */
export type LanguageLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'Nativo';

export interface CandidateLanguage {
  idioma: string;
  nivel: LanguageLevel;
}

/** RF-03 — Un puesto dentro de la línea de tiempo laboral del candidato. */
export interface CandidateTimelineEntry {
  empresa: string;
  rol: string;
  /** Formato libre extraído del CV (ej. "03/2021"). */
  desde: string;
  hasta: string;
  /** Duración calculada/inferida en meses (para detectar rotación). */
  meses: number;
  /** ¿Tuvo gente a cargo / lideró en este puesto? */
  liderazgo?: boolean;
}

/**
 * RF-03 — "Ficha Resumen" del candidato extraída del CV por el pipeline
 * de parsing (OCR + LLM), sin tipeo manual.
 */
export interface CandidateProfile {
  tituloAcademico: string | null;
  /** Mapeo de conocimientos técnicos. */
  conocimientos: string[];
  /** Mapeo de herramientas. */
  herramientas: string[];
  idiomas: CandidateLanguage[];
  /** Línea de tiempo laboral. */
  timeline: CandidateTimelineEntry[];
  experienciaTotalAnios: number;
  experienciaRelevanteAnios: number;
}

export interface Candidate {
  id: UUID;
  email: string;
  name: string;
  /** RF-03 — Apellido, extraído del CV. */
  lastName?: string | null;
  phone?: string | null;
  /** RF-03 — Datos personales extraídos del CV. */
  dni?: string | null;
  birthDate?: string | null;
  age?: number | null;
  location?: string | null;
  cvUrl?: string | null;
  cvText?: string | null;
  /** RF-03 — Ficha resumen parseada del CV. */
  profile?: CandidateProfile | null;
  notes?: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

// ============================================================
// RF-04 — Motor de matching y detección de patrones
// ============================================================
/**
 * Ponderación fija exigida por RF-04:
 *   Hard Skills 40% · Años de Experiencia 30% · Ubicación/Modalidad 15% · Educación 15%
 */
export interface MatchBreakdown {
  hardSkills: number;
  experiencia: number;
  ubicacionModalidad: number;
  educacion: number;
}

/** Puntos porcentuales por componente (suman 100). Enteros: evita drift de coma flotante. */
export const MATCH_WEIGHTS = {
  hardSkills: 40,
  experiencia: 30,
  ubicacionModalidad: 15,
  educacion: 15,
} as const;

/** RF-04 — Profiling de RRHH: patrones y riesgos detectados en la trayectoria. */
export interface RiskPatterns {
  /** Rotación: cambios de empleo en períodos < 1 año dentro de los últimos 4 años. */
  rotacionAlta: boolean;
  rotacionDetalle: string;
  /** Nivel de responsabilidad: gente a cargo, liderazgo de proyectos, presupuestos. */
  nivelResponsabilidad: 'sin_datos' | 'individual' | 'lider_proyecto' | 'gente_a_cargo';
  responsabilidadDetalle: string;
  /** Tecnologías exigidas por el puesto que NO están en el CV. */
  gaps: string[];
}

/**
 * RF-01/RF-04 — Postulación: vincula un candidato a un puesto (el CV se asocia
 * siempre a una vacante) y guarda el resultado del motor de matching.
 */
export interface Application {
  id: UUID;
  jobId: UUID;
  candidateId: UUID;
  matchPercent: number;
  breakdown: MatchBreakdown;
  patterns: RiskPatterns;
  resumenEjecutivo: string;
  createdAt: ISODate;
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
export type VoiceMode = 'live' | 'pipeline';

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
  consentRecording?: boolean;
  consentAnalysis?: boolean;
  voiceMode?: VoiceMode | null;
  /** Texto plano extraído del CV subido por el candidato (opcional). */
  cvText?: string | null;
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
