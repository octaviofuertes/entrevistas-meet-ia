import { describe, it, expect } from 'vitest';
import { computeMatch, detectPatterns } from './index';
import type { Candidate, CandidateTimelineEntry, Job } from '../../types';

/**
 * Criterios de aceptación (QA) del documento de especificación (CR):
 *  - Prueba de Detección de Patrones: 3 empleos en los últimos 2 años ⇒
 *    "Alto Índice de Rotación (< 1 año por puesto)".
 *  - Prueba de Score de Match: cumplir el 100% de las herramientas solicitadas
 *    ⇒ match representativo superior al 85%.
 */

function mmYYYY(monthsAgo: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function buildJob(overrides?: Partial<Job>): Job {
  const now = new Date().toISOString();
  return {
    id: 'job-1',
    sourceLink: 'form',
    title: 'Desarrollador Full Stack',
    company: 'Test Co',
    description: 'Puesto de prueba',
    requirements: {
      stack: ['React', 'TypeScript', 'Node.js'],
      seniority: 'semi',
      yearsOfExperience: 3,
      responsibilities: ['Desarrollo end-to-end'],
      niceToHave: [],
      language: 'es',
    },
    preferences: {
      durationMinutes: 20,
      dimensionsToCover: [],
      toneOfVoice: 'cercano',
      generateReport1: true,
      generateReport2: true,
    },
    questions: [],
    modality: 'remoto',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildCandidate(overrides?: Partial<Candidate>): Candidate {
  const now = new Date().toISOString();
  return {
    id: 'cand-1',
    email: 'ana@example.com',
    name: 'Ana',
    lastName: 'Pérez',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('RF-04 — Score de Match', () => {
  it('QA: cumplir el 100% de las herramientas solicitadas da un match > 85%', () => {
    const job = buildJob();
    const candidate = buildCandidate({
      profile: {
        tituloAcademico: 'Ingeniero en Sistemas',
        conocimientos: ['Arquitectura de software'],
        herramientas: ['React', 'TypeScript', 'Node.js'],
        idiomas: [],
        timeline: [],
        experienciaTotalAnios: 5,
        experienciaRelevanteAnios: 5,
      },
    });

    const result = computeMatch(job, candidate);

    expect(result.breakdown.hardSkills).toBe(100);
    expect(result.patterns.gaps).toEqual([]);
    expect(result.matchPercent).toBeGreaterThan(85);
  });

  it('respeta la ponderación 40/30/15/15 del requerimiento', () => {
    const job = buildJob();
    // Sin ninguna herramienta ni experiencia ni título: sólo puntúa ubicación
    // (remoto ⇒ 100% * 15%) y educación sin título (50% * 15% = 7.5).
    const candidate = buildCandidate({
      profile: {
        tituloAcademico: null,
        conocimientos: [],
        herramientas: [],
        idiomas: [],
        timeline: [],
        experienciaTotalAnios: 0,
        experienciaRelevanteAnios: 0,
      },
    });

    const result = computeMatch(job, candidate);

    expect(result.breakdown.hardSkills).toBe(0);
    expect(result.breakdown.experiencia).toBe(0);
    expect(result.breakdown.ubicacionModalidad).toBe(100);
    expect(result.breakdown.educacion).toBe(50);
    // 0*0.4 + 0*0.3 + 1*0.15 + 0.5*0.15 = 0.225 → 23%
    expect(result.matchPercent).toBe(23);
  });

  it('reporta como gaps las tecnologías exigidas que no están en el CV', () => {
    const job = buildJob();
    const candidate = buildCandidate({
      profile: {
        tituloAcademico: null,
        conocimientos: [],
        herramientas: ['React'],
        idiomas: [],
        timeline: [],
        experienciaTotalAnios: 2,
        experienciaRelevanteAnios: 2,
      },
    });

    const result = computeMatch(job, candidate);

    expect(result.patterns.gaps).toEqual(['TypeScript', 'Node.js']);
  });
});

describe('RF-04 — Detección de patrones', () => {
  it('QA: 3 empleos en los últimos 2 años ⇒ Alto Índice de Rotación', () => {
    const timeline: CandidateTimelineEntry[] = [
      { empresa: 'Empresa C', rol: 'Dev', desde: mmYYYY(8), hasta: 'Actualidad', meses: 8 },
      { empresa: 'Empresa B', rol: 'Dev', desde: mmYYYY(18), hasta: mmYYYY(9), meses: 9 },
      { empresa: 'Empresa A', rol: 'Dev', desde: mmYYYY(24), hasta: mmYYYY(19), meses: 5 },
    ];

    const patterns = detectPatterns(timeline, []);

    expect(patterns.rotacionAlta).toBe(true);
    expect(patterns.rotacionDetalle).toContain('Alto Índice de Rotación (< 1 año por puesto)');
  });

  it('permanencia larga NO se marca como rotación', () => {
    const timeline: CandidateTimelineEntry[] = [
      { empresa: 'Empresa B', rol: 'Dev', desde: mmYYYY(30), hasta: 'Actualidad', meses: 30 },
      { empresa: 'Empresa A', rol: 'Dev', desde: mmYYYY(60), hasta: mmYYYY(31), meses: 29 },
    ];

    const patterns = detectPatterns(timeline, []);

    expect(patterns.rotacionAlta).toBe(false);
  });

  it('detecta gente a cargo cuando el CV declara liderazgo y rol de jefatura', () => {
    const timeline: CandidateTimelineEntry[] = [
      { empresa: 'Empresa A', rol: 'Team Lead', desde: mmYYYY(40), hasta: 'Actualidad', meses: 40, liderazgo: true },
    ];

    const patterns = detectPatterns(timeline, []);

    expect(patterns.nivelResponsabilidad).toBe('gente_a_cargo');
  });

  it('marca colaborador individual cuando no hay evidencia de liderazgo', () => {
    const timeline: CandidateTimelineEntry[] = [
      { empresa: 'Empresa A', rol: 'Desarrollador', desde: mmYYYY(40), hasta: 'Actualidad', meses: 40 },
    ];

    const patterns = detectPatterns(timeline, []);

    expect(patterns.nivelResponsabilidad).toBe('individual');
  });
});
