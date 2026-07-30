import { describe, it, expect } from 'vitest';
import {
  hasEvaluableAnswers,
  isRealAnswer,
  deriveRecomendacion,
  reconcileReport2,
  buildInsufficientReport2,
  buildInsufficientReport1,
  averageDimensions,
  type TurnEval,
} from './report-aggregate';
import type { DimensionScores, Job, Report2Payload } from '../../types';

function dims(v: Partial<DimensionScores> = {}): DimensionScores {
  return { comunicacion: 0, tecnicos: 0, experiencia: 0, resolucion: 0, actitud: 0, trabajoEquipo: 0, ...v };
}

function buildJob(): Job {
  const now = new Date().toISOString();
  return {
    id: 'job-1', sourceLink: 'form', title: 'Dev', company: 'Test', description: 'x',
    requirements: { stack: ['React', 'Node'], seniority: 'semi', yearsOfExperience: 3, responsibilities: [], niceToHave: [], language: 'es' },
    preferences: { durationMinutes: 10, dimensionsToCover: [], toneOfVoice: 'cercano', generateReport1: true, generateReport2: true },
    questions: [], createdAt: now, updatedAt: now,
  };
}

/** Payload "inflado" como el que podría devolver el LLM sin datos reales. */
function inflatedPayload(over: Partial<Report2Payload> = {}): Report2Payload {
  return {
    executiveSummary: 'texto', scoreTotal: 5,
    dimensions: dims({ comunicacion: 5, tecnicos: 5, experiencia: 5, resolucion: 5, actitud: 5, trabajoEquipo: 5 }),
    stackScores: { React: 9, Node: 9 }, softskills: 9, strengths: ['x'], weaknesses: [], flags: [],
    sentimentDistribution: { positive: 60, neutral: 30, negative: 10, notApplicable: 0 },
    qualityDistribution: { excellent: 100, good: 0, fair: 0, poor: 0 }, turnsAnalyzed: 2,
    recomendacion: 'avanzar', recomendacionReason: 'Promedio 5/10 recomendamos avanzar', ...over,
  };
}

const STACK = ['React', 'Node'];

describe('report-aggregate — informe fiel y coherente', () => {
  it('un turno real necesita >=3 palabras y sin flag de no-respuesta', () => {
    expect(isRealAnswer({ question: 'q', transcript: 'trabajé con react en un ecommerce', score: 7, dims: dims() })).toBe(true);
    expect(isRealAnswer({ question: 'q', transcript: 'eh no', score: 4, dims: dims() })).toBe(false);      // 2 palabras
    expect(isRealAnswer({ question: 'q', transcript: 'no sé nada igual', score: 4, dims: dims(), flags: ['respuesta_vacia'] })).toBe(false); // flag
  });

  it('sin respuestas reales → NO evaluable (el engine usa el informe insuficiente)', () => {
    expect(hasEvaluableAnswers([])).toBe(false);
    expect(hasEvaluableAnswers([{ question: 'q', transcript: 'eh', score: 4, dims: dims() }])).toBe(false);
    // "eh, no" son 2 palabras → sigue sin ser evaluable (arreglo del piso 1.5 del mock).
    expect(hasEvaluableAnswers([{ question: 'q', transcript: 'eh no', score: 1.7, dims: dims({ actitud: 2 }) }])).toBe(false);
  });

  it('el Informe 2 "insuficiente" da 0 y descartar, sin inventar', () => {
    const r2 = buildInsufficientReport2(buildJob(), null);
    expect(r2.scoreTotal).toBe(0);
    expect(r2.recomendacion).toBe('descartar');
    expect(r2.turnsAnalyzed).toBe(0);
    expect(Object.values(r2.dimensions).every((v) => v === 0)).toBe(true);
    expect(Object.values(r2.stackScores).every((v) => v === 0)).toBe(true);
  });

  it('el Informe 1 "insuficiente" no fabrica highlights ni resumen positivo', () => {
    const r1 = buildInsufficientReport1({ fullTranscript: [], durationSec: 12, language: 'es', behavior: null });
    expect(r1.highlights).toEqual([]);
    expect(r1.summary).toMatch(/sin respuestas/i);
  });

  it('REGRESIÓN: un scoreTotal inflado del LLM (5) se reemplaza por el real de los turnos', () => {
    const evals: TurnEval[] = [
      { question: 'q1', transcript: 'la verdad no sé bien', score: 1.5, dims: dims({ comunicacion: 2 }) },
      { question: 'q2', transcript: 'eh, algo hice pero poco', score: 2, dims: dims({ comunicacion: 2 }) },
    ];
    const out = reconcileReport2(inflatedPayload(), evals, STACK, null);
    expect(out.scoreTotal).toBeCloseTo(1.8, 1);
    expect(out.recomendacion).toBe('descartar');
  });

  it('COHERENCIA: el radar, softskills y stackScores no pueden quedar inflados sobre un score bajo', () => {
    const evals: TurnEval[] = [
      { question: 'q1', transcript: 'no entendí muy bien la pregunta', score: 2, dims: dims({ comunicacion: 2, actitud: 2, trabajoEquipo: 2 }) },
      { question: 'q2', transcript: 'no tengo experiencia en eso', score: 2, dims: dims({ comunicacion: 2, actitud: 2, trabajoEquipo: 2 }) },
    ];
    // El LLM devolvió radar 5/5, stack 9/9, softskills 9 (inflado).
    const out = reconcileReport2(inflatedPayload(), evals, STACK, null);
    // Radar reconciliado a los ~2 reales, no 5.
    expect(out.dimensions.comunicacion).toBeCloseTo(2, 1);
    expect(out.softskills).toBeLessThan(3);
    // stackScores no pueden mostrar 9 si la técnica real fue ~0.
    expect(out.stackScores['React']).toBeLessThanOrEqual(3);
    // sentiment se recalcula (no queda el 60% positive del LLM).
    expect(out.sentimentDistribution.positive).toBeLessThan(50);
    // la justificación es coherente con el veredicto real.
    expect(out.recomendacionReason).toMatch(/no se recomienda/i);
  });

  it('REGRESIÓN INVERSA: un candidato fuerte con preguntas personales NO se hunde por tecnicos=0', () => {
    const strong = dims({ comunicacion: 8, experiencia: 8, resolucion: 8, actitud: 8, trabajoEquipo: 8 });
    const evals: TurnEval[] = [
      // Técnicas (tecnicos alto)
      { question: 'q1', transcript: 'expliqué el ciclo de vida de react con ejemplos', score: 8, dims: { ...strong, tecnicos: 8 } },
      { question: 'q2', transcript: 'diseñé la arquitectura del backend en node', score: 8.5, dims: { ...strong, tecnicos: 8 } },
      // Personales (pregunta no técnica → tecnicos=0 guardado)
      { question: 'q3', transcript: 'me motiva mucho resolver problemas complejos', score: 8, dims: { ...strong, tecnicos: 0 } },
      { question: 'q4', transcript: 'trabajo muy bien en equipo y comunico claro', score: 8, dims: { ...strong, tecnicos: 0 } },
    ];
    const out = reconcileReport2(inflatedPayload({ dimensions: { ...strong, tecnicos: 8 } }), evals, STACK, null);
    // tecnicos se promedia SOLO sobre los turnos técnicos → 8, no (8+8+0+0)/4=4.
    expect(out.dimensions.tecnicos).toBe(8);
    expect(out.scoreTotal).toBeGreaterThanOrEqual(7.5);
    expect(out.recomendacion).toBe('avanzar');
  });

  it('deriveRecomendacion respeta los umbrales del documento', () => {
    expect(deriveRecomendacion(8, 7)).toBe('avanzar');
    expect(deriveRecomendacion(8, 6)).toBe('segunda_instancia');
    expect(deriveRecomendacion(6, 5)).toBe('segunda_instancia');
    expect(deriveRecomendacion(4, 4)).toBe('descartar');
  });

  it('averageDimensions: tecnicos solo sobre turnos técnicos, resto sobre todos', () => {
    const evals: TurnEval[] = [
      { question: 'q', transcript: 'a b c', score: 6, dims: dims({ comunicacion: 6, tecnicos: 8 }) },
      { question: 'q', transcript: 'd e f', score: 8, dims: dims({ comunicacion: 8, tecnicos: 0 }) },
    ];
    const d = averageDimensions(evals);
    expect(d.comunicacion).toBe(7);  // (6+8)/2
    expect(d.tecnicos).toBe(8);       // solo el turno con tecnicos>0
  });
});
