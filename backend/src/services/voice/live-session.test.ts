import { describe, it, expect } from 'vitest';
import { buildLiveSystemPrompt } from './live-session';
import type { Job, Candidate } from '../../types';

const job: Job = {
  id: 'job-1',
  sourceLink: 'form',
  title: 'QA Automation Semi',
  company: 'Acme QA',
  description: 'desc',
  requirements: {
    stack: ['Cypress'],
    seniority: 'semi',
    yearsOfExperience: 3,
    responsibilities: [],
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
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z',
};

const candidate: Candidate = {
  id: 'cand-1',
  email: 'ana@example.com',
  name: 'Ana Pérez',
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z',
};

describe('buildLiveSystemPrompt', () => {
  it('incluye el nombre del candidato, el puesto y la empresa', () => {
    const prompt = buildLiveSystemPrompt(job, candidate);
    expect(prompt).toContain('Ana Pérez');
    expect(prompt).toContain('QA Automation Semi');
    expect(prompt).toContain('Acme QA');
  });

  it('incluye el tono de voz preferido del puesto', () => {
    const prompt = buildLiveSystemPrompt(job, candidate);
    expect(prompt).toContain('cercano');
  });

  it('incluye el texto del CV cuando está presente', () => {
    const prompt = buildLiveSystemPrompt(job, candidate, 'Experiencia en Cypress y Playwright');
    expect(prompt).toContain('Experiencia en Cypress y Playwright');
  });

  it('no agrega una sección vacía cuando no hay CV', () => {
    const prompt = buildLiveSystemPrompt(job, candidate, null);
    expect(prompt).not.toContain('undefined');
    expect(prompt).not.toContain('CV del candidato');
  });
});
