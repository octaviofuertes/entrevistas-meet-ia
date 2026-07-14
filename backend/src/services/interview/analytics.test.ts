import { describe, it, expect } from 'vitest';
import {
  computeQualityDistribution,
  computeSentimentFallback,
  isEmptySentiment,
} from './analytics';

describe('computeQualityDistribution (umbrales: excellent>=8, good>=6, fair>=4, poor<4)', () => {
  it('bucketiza scores [9,8,7,6,5,4,3] en porcentajes enteros que suman 100', () => {
    const turns = [9, 8, 7, 6, 5, 4, 3].map((score) => ({ score }));
    const dist = computeQualityDistribution(turns);
    expect(dist.excellent + dist.good + dist.fair + dist.poor).toBe(100);
    expect(dist).toEqual({ excellent: 28, good: 29, fair: 29, poor: 14 });
  });

  it('sin turnos, todos los buckets quedan en 0', () => {
    expect(computeQualityDistribution([])).toEqual({ excellent: 0, good: 0, fair: 0, poor: 0 });
  });
});

describe('computeSentimentFallback (señales objetivas: vacío/incomprensible, score, flags)', () => {
  it('clasifica cada caso según la regla documentada', () => {
    const turns = [
      { score: 9, transcript: 'buena respuesta con ejemplos', flags: [] },
      { score: 5, transcript: 'respuesta correcta pero plana', flags: [] },
      { score: 3, transcript: 'respuesta pobre', flags: [] },
      { score: 0, transcript: '', flags: [] },
      { score: 6, transcript: 'algo dijo', flags: ['incomprensible'] },
    ];
    const dist = computeSentimentFallback(turns);
    expect(dist.positive + dist.neutral + dist.negative + dist.notApplicable).toBe(100);
    expect(dist).toEqual({ positive: 20, neutral: 20, negative: 20, notApplicable: 40 });
  });

  it('respuesta_vaga fuerza negative aunque el score no sea bajo', () => {
    const dist = computeSentimentFallback([
      { score: 8, transcript: 'si', flags: ['respuesta_vaga'] },
    ]);
    expect(dist).toEqual({ positive: 0, neutral: 0, negative: 100, notApplicable: 0 });
  });
});

describe('isEmptySentiment', () => {
  it('true cuando todas las distribuciones están en 0 o es null/undefined', () => {
    expect(isEmptySentiment(null)).toBe(true);
    expect(isEmptySentiment(undefined)).toBe(true);
    expect(isEmptySentiment({ positive: 0, neutral: 0, negative: 0, notApplicable: 0 })).toBe(true);
  });

  it('false cuando hay al menos un valor no nulo', () => {
    expect(isEmptySentiment({ positive: 10, neutral: 0, negative: 0, notApplicable: 90 })).toBe(false);
  });
});
