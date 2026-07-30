import { ALL_DIMENSIONS, DIMENSION_LABELS } from '../../types';
import type {
  BehavioralAnalysis,
  DimensionScores,
  Job,
  Report1Payload,
  Report2Payload,
} from '../../types';
import { computeQualityDistribution, computeSentimentFallback } from './analytics';

/** Una evaluación por turno tal como la usa el engine para armar los informes. */
export interface TurnEval {
  question: string;
  transcript: string;
  score: number;
  dims: DimensionScores;
  flags?: string[];
}

/** Flags que marcan un turno como "no respuesta" (no cuenta para el score). */
const NON_ANSWER_FLAGS = new Set(['respuesta_vacia', 'incomprensible', 'no_responde_lo_preguntado']);

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp10(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, round1(n)));
}

/** Cantidad de palabras "útiles" en un texto. */
export function wordCount(text: string): number {
  return (text ?? '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * ¿Este turno es una respuesta REAL? Debe tener contenido (>= 3 palabras) y no
 * estar marcado como vacío/incomprensible. Un "eh, no" o un balbuceo NO cuenta,
 * así el score no se infla por turnos donde el candidato no dijo nada.
 */
export function isRealAnswer(e: TurnEval): boolean {
  if (wordCount(e.transcript) < 3) return false;
  return !(e.flags ?? []).some((f) => NON_ANSWER_FLAGS.has(f));
}

/**
 * ¿La entrevista tuvo respuestas evaluables? Si no (cortó al inicio, no habló,
 * solo balbuceos), el informe no fabrica un puntaje: usa el "insuficiente".
 */
export function hasEvaluableAnswers(evals: TurnEval[]): boolean {
  return evals.some(isRealAnswer);
}

/**
 * Promedio determinístico de dimensiones sobre las respuestas reales.
 * `tecnicos` se promedia SOLO sobre los turnos donde efectivamente se evaluó
 * (valor > 0): las preguntas no técnicas guardan tecnicos=0 y NO deben hundir
 * la dimensión técnica de un candidato bueno que además tuvo preguntas blandas.
 */
export function averageDimensions(real: TurnEval[]): DimensionScores {
  const out: DimensionScores = {
    comunicacion: 0, tecnicos: 0, experiencia: 0, resolucion: 0, actitud: 0, trabajoEquipo: 0,
  };
  if (real.length === 0) return out;
  for (const d of ALL_DIMENSIONS) {
    if (d === 'tecnicos') {
      const tech = real.filter((e) => (Number(e.dims?.tecnicos) || 0) > 0);
      out.tecnicos = tech.length
        ? clamp10(tech.reduce((a, e) => a + (Number(e.dims.tecnicos) || 0), 0) / tech.length)
        : 0;
    } else {
      out[d] = clamp10(real.reduce((a, e) => a + (Number(e.dims?.[d]) || 0), 0) / real.length);
    }
  }
  return out;
}

/**
 * Recomendación derivada de números reales (mismos umbrales del prompt del
 * Informe 2), para que no dependa del criterio variable del LLM.
 */
export function deriveRecomendacion(
  scoreTotal: number,
  tecnicos: number
): Report2Payload['recomendacion'] {
  if (scoreTotal >= 7.5 && tecnicos >= 6.5) return 'avanzar';
  if (scoreTotal >= 5.5 && tecnicos >= 5) return 'segunda_instancia';
  return 'descartar';
}

/** stackScores acotados por el nivel técnico real: no puede haber una tecnología en 9 si el candidato apenas demostró técnica. */
function reconcileStackScores(
  llm: Record<string, number> | undefined,
  tecnicos: number,
  stack: string[]
): Record<string, number> {
  const cap = clamp10(tecnicos + 2);
  const out: Record<string, number> = {};
  for (const tech of stack) {
    const raw = Number(llm?.[tech]);
    out[tech] = clamp10(Math.min(Number.isFinite(raw) ? raw : 0, cap));
  }
  return out;
}

/** Justificación determinística coherente con el score y la recomendación finales. */
function buildRecomendacionReason(
  scoreTotal: number,
  dims: DimensionScores,
  rec: Report2Payload['recomendacion'],
  turnsAnalyzed: number
): string {
  const entries = ALL_DIMENSIONS.map((d) => ({ d, v: dims[d] }));
  const strong = entries.reduce((a, b) => (b.v > a.v ? b : a));
  const weak = entries.reduce((a, b) => (b.v < a.v ? b : a));
  const verdict =
    rec === 'avanzar' ? 'Se recomienda avanzar en el proceso.'
    : rec === 'segunda_instancia' ? 'Se sugiere una segunda instancia enfocada.'
    : 'No se recomienda avanzar.';
  return `Puntaje ${scoreTotal}/10 sobre ${turnsAnalyzed} ${turnsAnalyzed === 1 ? 'respuesta' : 'respuestas'} evaluadas. Más fuerte: ${DIMENSION_LABELS[strong.d]} (${strong.v}); más débil: ${DIMENSION_LABELS[weak.d]} (${weak.v}). ${verdict}`;
}

/**
 * Reconcilia TODOS los números del Informe 2 con las evaluaciones reales por
 * turno, para que el informe sea fiel y coherente (el LLM no puede inflar ni
 * contradecirse). Del LLM se conserva sólo el texto descriptivo (fortalezas,
 * debilidades, resumen). El engine debe llamar esto sólo cuando hay respuestas
 * evaluables; si no, usar buildInsufficientReport2.
 */
export function reconcileReport2(
  payload: Report2Payload,
  evals: TurnEval[],
  stack: string[],
  behavior: BehavioralAnalysis | null
): Report2Payload {
  const real = evals.filter(isRealAnswer);

  const scoreTotal = real.length
    ? clamp10(real.reduce((a, e) => a + (Number(e.score) || 0), 0) / real.length)
    : 0;
  const dimensions = averageDimensions(real);
  const softskills = clamp10((dimensions.comunicacion + dimensions.actitud + dimensions.trabajoEquipo) / 3);
  const recomendacion = deriveRecomendacion(scoreTotal, dimensions.tecnicos);
  const stackScores = reconcileStackScores(payload.stackScores, dimensions.tecnicos, stack);

  const turnSignals = real.map((e) => ({ score: e.score, transcript: e.transcript, flags: e.flags }));
  const qualityDistribution = computeQualityDistribution(turnSignals);
  const turnsAnalyzed = real.length;
  // Sentimiento SIEMPRE determinístico (mismas señales que quality/score), para
  // que los paneles del informe no se contradigan entre sí.
  const sentimentDistribution = computeSentimentFallback(turnSignals);

  return {
    ...payload,
    scoreTotal,
    dimensions,
    softskills,
    stackScores,
    recomendacion,
    recomendacionReason: buildRecomendacionReason(scoreTotal, dimensions, recomendacion, turnsAnalyzed),
    qualityDistribution,
    turnsAnalyzed,
    sentimentDistribution,
    behavior,
  };
}

/**
 * Informe 2 honesto cuando NO hubo respuestas evaluables (entrevista cortada
 * al inicio, candidato que no habló, etc.): score 0, "descartar", sin inventar.
 */
export function buildInsufficientReport2(job: Job, behavior: BehavioralAnalysis | null): Report2Payload {
  const stackScores: Record<string, number> = {};
  for (const tech of job.requirements.stack) stackScores[tech] = 0;
  return {
    executiveSummary:
      'La entrevista terminó sin respuestas evaluables (el candidato no respondió o cortó antes de dar contenido). No hay material suficiente para evaluarlo.',
    scoreTotal: 0,
    dimensions: {
      comunicacion: 0, tecnicos: 0, experiencia: 0, resolucion: 0, actitud: 0, trabajoEquipo: 0,
    },
    stackScores,
    softskills: 0,
    strengths: [],
    weaknesses: ['El candidato no dio ninguna respuesta evaluable durante la entrevista.'],
    flags: ['sin_respuestas'],
    sentimentDistribution: { positive: 0, neutral: 0, negative: 0, notApplicable: 0 },
    qualityDistribution: { excellent: 0, good: 0, fair: 0, poor: 0 },
    turnsAnalyzed: 0,
    behavioralObservations: [],
    suspectedReading: false,
    behavior,
    recomendacion: 'descartar',
    recomendacionReason:
      'No se obtuvo ninguna respuesta evaluable; la entrevista terminó antes de poder valorar al candidato.',
  };
}

/**
 * Informe 1 honesto para el mismo caso: describe que la entrevista terminó sin
 * respuestas, sin fabricar highlights ni resúmenes.
 */
export function buildInsufficientReport1(input: {
  fullTranscript: Array<{ speaker: 'bot' | 'candidate'; text: string; atMs: number }>;
  durationSec: number;
  language: string;
  behavior: BehavioralAnalysis | null;
}): Report1Payload {
  return {
    summary:
      'La entrevista terminó sin respuestas evaluables del candidato. No hubo contenido suficiente para un resumen.',
    highlights: [],
    keyMoments: [],
    topicsCovered: [],
    concerns: ['La entrevista finalizó sin respuestas evaluables del candidato.'],
    behavioralObservations: [],
    behavior: input.behavior,
    fullTranscript: input.fullTranscript,
    durationSec: input.durationSec,
    language: input.language,
  };
}
