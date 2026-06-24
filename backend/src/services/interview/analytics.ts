import type { QualityDistribution, SentimentDistribution } from '../../types';

export interface TurnSignal {
  score: number;
  /** Texto de la respuesta del candidato (vacío = no respondió). */
  transcript?: string;
  flags?: string[];
}

/** Convierte un array de porcentajes crudos a enteros que suman exactamente 100. */
function toPercentages(counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return counts.map(() => 0);
  const raw = counts.map((c) => (c / total) * 100);
  const rounded = raw.map((r) => Math.round(r));
  let diff = 100 - rounded.reduce((a, b) => a + b, 0);
  // Repartimos el error de redondeo empezando por los buckets más grandes.
  const order = raw
    .map((_, i) => i)
    .sort((a, b) => raw[b] - raw[a]);
  let k = 0;
  while (diff !== 0 && order.length > 0) {
    const idx = order[k % order.length];
    rounded[idx] += diff > 0 ? 1 : -1;
    diff += diff > 0 ? -1 : 1;
    k++;
  }
  return rounded;
}

/**
 * Calidad de las respuestas a partir del score por turno (0-10):
 *   excellent >= 8 · good 6-7.99 · fair 4-5.99 · poor < 4
 */
export function computeQualityDistribution(turns: TurnSignal[]): QualityDistribution {
  let excellent = 0, good = 0, fair = 0, poor = 0;
  for (const t of turns) {
    const s = t.score;
    if (s >= 8) excellent++;
    else if (s >= 6) good++;
    else if (s >= 4) fair++;
    else poor++;
  }
  const [e, g, f, p] = toPercentages([excellent, good, fair, poor]);
  return { excellent: e, good: g, fair: f, poor: p };
}

/**
 * Sentimiento del candidato por turno, derivado de señales objetivas
 * (score + flags + si respondió). Se usa como fallback cuando la IA no
 * devolvió una distribución válida.
 *   notApplicable: respuesta vacía o flag incomprensible/no_responde
 *   negative: score < 4.5 o flag de respuesta vaga
 *   neutral: 4.5 <= score < 7
 *   positive: score >= 7
 */
export function computeSentimentFallback(turns: TurnSignal[]): SentimentDistribution {
  let positive = 0, neutral = 0, negative = 0, notApplicable = 0;
  for (const t of turns) {
    const text = (t.transcript ?? '').trim();
    const flags = t.flags ?? [];
    const noAnswer =
      !text ||
      flags.includes('incomprensible') ||
      flags.includes('no_responde_lo_preguntado');
    if (noAnswer) { notApplicable++; continue; }
    if (t.score < 4.5 || flags.includes('respuesta_vaga')) { negative++; continue; }
    if (t.score < 7) { neutral++; continue; }
    positive++;
  }
  const [pos, neu, neg, na] = toPercentages([positive, neutral, negative, notApplicable]);
  return { positive: pos, neutral: neu, negative: neg, notApplicable: na };
}

export function isEmptySentiment(s: SentimentDistribution | undefined | null): boolean {
  if (!s) return true;
  return (s.positive + s.neutral + s.negative + s.notApplicable) === 0;
}
