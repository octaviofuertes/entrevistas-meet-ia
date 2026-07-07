import { config } from '../../config';
import { logger } from '../../logger';
import { MockLeia } from './mock';
import { ClaudeLeia } from './claude';
import { GeminiLeia } from './gemini';
import type {
  Job,
  InterviewTurn,
  DimensionScores,
  Report1Payload,
  Report2Payload,
  BehavioralAnalysis,
} from '../../types';

export interface EvaluateInput {
  job: Job;
  candidateName: string;
  history: InterviewTurn[];
  lastQuestion: string;
  lastAnswer: string;
  turnIndex: number;
  elapsedSec: number;
}

export interface EvaluateOutput {
  evaluation: {
    score: number;
    dimensions: DimensionScores;
    flags: string[];
    rationale: string;
  };
  nextQuestion: string;
  /** true si la nextQuestion es una aclaración (no avanza de turno temático). */
  isClarification?: boolean;
  shouldFinish: boolean;
}

export interface FirstQuestionInput {
  job: Job;
  candidateName: string;
}

export interface StructureJobInput {
  title: string;
  description: string;
  knowledge: string;
  language: string;
}

export interface StructureJobOutput {
  stack: string[];
  seniority: Job['requirements']['seniority'];
  yearsOfExperience: number;
  responsibilities: string[];
  niceToHave: string[];
}

export interface Report1Input {
  job: Job;
  candidateName: string;
  fullTranscript: Array<{ speaker: 'bot' | 'candidate'; text: string; atMs: number }>;
  durationSec: number;
  language: string;
  behavior?: BehavioralAnalysis | null;
}

export interface Report2Input {
  job: Job;
  candidateName: string;
  evaluations: Array<{
    question: string;
    transcript: string;
    score: number;
    dims: DimensionScores;
    flags: string[];
  }>;
  behavior?: BehavioralAnalysis | null;
}

export interface LeiaService {
  firstQuestion(input: FirstQuestionInput): Promise<string>;
  evaluate(input: EvaluateInput): Promise<EvaluateOutput>;
  buildReport1(input: Report1Input): Promise<Report1Payload>;
  buildReport2(input: Report2Input): Promise<Report2Payload>;
  /**
   * Genera un set de muletillas cortas y contextualizadas para reproducir
   * mientras leIA "piensa" la siguiente pregunta. Devolver entre 6 y 12.
   */
  generateFillers(input: FirstQuestionInput): Promise<string[]>;
  /** Genera el cierre de la entrevista, contextualizado al candidato y puesto. */
  generateClosing(input: FirstQuestionInput): Promise<string>;
  /** Estructura un puesto cargado por formulario: deduce stack, seniority y responsabilidades. */
  structureJob(input: StructureJobInput): Promise<StructureJobOutput>;
}

let instance: LeiaService | null = null;

export function getLeia(): LeiaService {
  if (instance) return instance;

  if (config.LEIA_DRIVER === 'gemini') {
    if (!config.GEMINI_API_KEY) {
      logger.warn('LEIA_DRIVER=gemini pero GEMINI_API_KEY vacío. Usando mock como fallback.');
      instance = new MockLeia();
    } else {
      logger.info({ model: config.GEMINI_MODEL }, 'leIA inicializada con Gemini (driver temporal)');
      instance = new GeminiLeia();
    }
  } else if (config.LEIA_DRIVER === 'claude') {
    if (!config.ANTHROPIC_API_KEY) {
      logger.warn('LEIA_DRIVER=claude pero ANTHROPIC_API_KEY vacío. Usando mock como fallback.');
      instance = new MockLeia();
    } else {
      logger.info({ model: config.LEIA_MODEL }, 'leIA inicializada con Claude');
      instance = new ClaudeLeia();
    }
  } else {
    logger.info('leIA en modo mock');
    instance = new MockLeia();
  }
  return instance;
}
