import { describe, it, expect } from 'vitest';
import { LEIA_SYSTEM_PROMPT, buildEvaluatePrompt, buildReport2Prompt } from './prompts';
import type { Job } from '../../types';

const job: Job = {
  id: 'job-1',
  sourceLink: 'form',
  title: 'Frontend Semi',
  company: 'Acme',
  description: 'desc',
  requirements: {
    stack: ['React'],
    seniority: 'semi',
    yearsOfExperience: 3,
    responsibilities: [],
    niceToHave: [],
    language: 'es',
  },
  preferences: {
    durationMinutes: 20,
    dimensionsToCover: ['tecnicos'],
    toneOfVoice: 'cercano',
    generateReport1: true,
    generateReport2: true,
  },
  questions: [],
  createdAt: '2026-07-09T00:00:00.000Z',
  updatedAt: '2026-07-09T00:00:00.000Z',
};

describe('LEIA_SYSTEM_PROMPT', () => {
  it('contiene la regla 11 de uso activo del CV', () => {
    expect(LEIA_SYSTEM_PROMPT).toContain('11. Si el turno incluye una sección "CV DEL CANDIDATO"');
  });
});

describe('buildEvaluatePrompt', () => {
  const base = {
    job,
    candidateName: 'Ana Pérez',
    history: [],
    lastQuestion: '¿Contame de tu experiencia?',
    lastAnswer: 'Trabajé en React.',
    turnIndex: 0,
  };

  it('con cvText: incluye la sección de CV y referencia la regla 11', () => {
    const prompt = buildEvaluatePrompt({ ...base, cvText: 'Trabajé 3 años en MercadoLibre.' });
    expect(prompt).toContain('CV DEL CANDIDATO');
    expect(prompt).toContain('regla 11');
  });

  it('sin cvText: no menciona el CV', () => {
    const prompt = buildEvaluatePrompt({ ...base, cvText: null });
    expect(prompt).not.toContain('CV');
  });
});

describe('buildReport2Prompt', () => {
  const base = {
    job,
    candidateName: 'Ana Pérez',
    evaluations: [
      {
        question: '¿Contame de tu experiencia?',
        transcript: 'Trabajé en React.',
        score: 7,
        dims: {
          comunicacion: 7,
          tecnicos: 7,
          experiencia: 7,
          resolucion: 7,
          actitud: 7,
          trabajoEquipo: 7,
        },
        flags: [],
      },
    ],
  };

  it('con cvText: incluye la sección de CV', () => {
    const prompt = buildReport2Prompt({ ...base, cvText: 'Trabajé 3 años en MercadoLibre.' });
    expect(prompt).toContain('CV DEL CANDIDATO');
  });

  it('sin cvText: no incluye la sección de CV', () => {
    const prompt = buildReport2Prompt({ ...base, cvText: null });
    expect(prompt).not.toContain('CV DEL CANDIDATO');
  });
});
