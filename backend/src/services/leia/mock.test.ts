import { describe, it, expect } from 'vitest';
import { MockLeia, extractCvHighlight } from './mock';
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
    dimensionsToCover: [],
    toneOfVoice: 'cercano',
    generateReport1: true,
    generateReport2: true,
  },
  questions: [],
  createdAt: '2026-07-07T00:00:00.000Z',
  updatedAt: '2026-07-07T00:00:00.000Z',
};

describe('extractCvHighlight', () => {
  it('extrae el nombre propio más largo que no sea el del candidato', () => {
    const cv = 'Ana Pérez\nTrabajé 3 años en MercadoLibre como frontend.';
    expect(extractCvHighlight(cv, 'Ana Pérez')).toBe('MercadoLibre');
  });

  it('no devuelve el nombre del candidato como highlight', () => {
    const cv = 'Ana Pérez\nDesarrolladora con experiencia en proyectos web.';
    const highlight = extractCvHighlight(cv, 'Ana Pérez');
    expect(highlight).not.toBe('Ana Pérez');
  });

  it('sin nombres propios, devuelve la primera línea no vacía (truncada a 60 chars)', () => {
    const cv = '\n\nexperiencia en desarrollo web durante varios años en distintas empresas';
    expect(extractCvHighlight(cv, 'Ana Pérez')).toBe(
      'experiencia en desarrollo web durante varios años en distint…'
    );
  });

  it('devuelve null con texto vacío', () => {
    expect(extractCvHighlight('', 'Ana Pérez')).toBeNull();
  });
});

describe('MockLeia.firstQuestion — cita concreta del CV (AC-NEW-06)', () => {
  it('el saludo menciona contenido concreto del CV cuando está presente', async () => {
    const leia = new MockLeia();
    const question = await leia.firstQuestion({
      job,
      candidateName: 'Ana Pérez',
      cvText: 'Ana Pérez\nTrabajé 3 años en MercadoLibre como frontend.',
    });
    expect(question).toContain('MercadoLibre');
  });

  it('sin CV, el saludo no menciona nada de CV', async () => {
    const leia = new MockLeia();
    const question = await leia.firstQuestion({ job, candidateName: 'Ana Pérez' });
    expect(question).not.toContain('CV');
  });
});
