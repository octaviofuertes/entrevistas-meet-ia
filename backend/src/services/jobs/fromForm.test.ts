import { describe, it, expect } from 'vitest';
import { buildJobFromForm } from './fromForm';

/**
 * Requiere LEIA_DRIVER=mock (backend/.env) para que structureJob() use la
 * heurística determinista de detectStack/detectSeniority reutilizada de
 * services/jobs/fromLink.ts.
 */
describe('buildJobFromForm (mock)', () => {
  it('estructura un puesto detectando stack y seniority, con metadata persistida', async () => {
    const job = await buildJobFromForm({
      title: 'Fullstack Semi Pleno',
      company: 'Acme',
      description: 'Buscamos dev con React, Node.js y PostgreSQL para APIs',
      knowledge: 'APIs REST, testing',
      location: 'Mendoza',
      modality: 'remoto',
      vacancies: 2,
    });

    expect(job.sourceLink).toBe('form');
    expect(job.title).toBe('Fullstack Semi Pleno');
    expect(job.company).toBe('Acme');
    expect(job.requirements.stack).toEqual(
      expect.arrayContaining(['React', 'Node.js', 'PostgreSQL'])
    );
    expect(job.requirements.seniority).toBe('semi');
    expect(job.location).toBe('Mendoza');
    expect(job.modality).toBe('remoto');
    expect(job.vacancies).toBe(2);
    expect(job.hiringStatus).toBe('abierto');
    expect(job.preferences.behavioralAnalysisEnabled).toBe(true);
  });

  it('detecta seniority "senior" con el abreviador Sr como palabra suelta', async () => {
    const job = await buildJobFromForm({
      title: 'Dev Sr Backend',
      description: 'Buscamos alguien con experiencia en Node.js',
      knowledge: 'APIs REST',
    });
    expect(job.requirements.seniority).toBe('senior');
  });

  it('el título "SSR Fullstack" no se confunde con "senior" (fix del bug de regex)', async () => {
    const job = await buildJobFromForm({
      title: 'SSR Fullstack',
      description: 'Buscamos dev con React, Node.js y PostgreSQL',
      knowledge: 'APIs REST',
    });
    expect(job.requirements.seniority).toBe('semi');
  });
});
