import { v4 as uuid } from 'uuid';
import { logger } from '../logger';
import type { Database } from './index';
import type { Candidate, Job } from '../types';

export async function seedDb(db: Database) {
  const now = new Date().toISOString();

  // ---------- Puesto demo: Frontend React Senior ----------
  const job: Job = {
    id: uuid(),
    sourceLink: 'https://demo.linkedin.com/jobs/view/frontend-react-senior-12345',
    title: 'Frontend React Senior',
    company: 'leIA Tech',
    description:
      'Buscamos un/a Frontend Senior con experiencia sólida en React, TypeScript y arquitecturas SPA. ' +
      'Vas a liderar el desarrollo del nuevo dashboard de RRHH del producto.',
    requirements: {
      stack: ['React', 'TypeScript', 'Next.js', 'Tailwind', 'Testing'],
      seniority: 'senior',
      yearsOfExperience: 5,
      responsibilities: [
        'Liderar la arquitectura del frontend',
        'Mentorear a desarrolladores semi senior',
        'Asegurar performance y accesibilidad',
      ],
      niceToHave: ['Experiencia con WebSockets', 'GraphQL', 'Animaciones avanzadas'],
      language: 'es',
    },
    preferences: {
      durationMinutes: 20,
      dimensionsToCover: [
        'comunicacion',
        'tecnicos',
        'experiencia',
        'resolucion',
        'actitud',
        'trabajoEquipo',
      ],
      toneOfVoice: 'cercano',
      generateReport1: true,
      generateReport2: true,
    },
    rawText: 'Frontend React Senior – Buscamos perfil senior con foco en React/TS.',
    createdAt: now,
    updatedAt: now,
  };
  await db.createJob(job);

  // ---------- Candidato demo ----------
  const candidate: Candidate = {
    id: uuid(),
    email: 'candidato.demo@example.com',
    name: 'Juan Demo',
    phone: '+54 11 5555 0000',
    cvUrl: null,
    notes: 'Candidato seed: 5 años con React, último trabajo en una fintech.',
    createdAt: now,
    updatedAt: now,
  };
  await db.createCandidate(candidate);

  logger.info({ jobId: job.id, candidateId: candidate.id }, 'Seed cargado');
}

// Permite ejecutar el seed standalone contra postgres.
if (require.main === module) {
  (async () => {
    const { getDb } = await import('./index');
    const db = await getDb();
    if ((db as any).constructor.name === 'MemoryDb') {
      logger.info('MemoryDb se siembra sola en init() - nada que hacer');
      return;
    }
    await seedDb(db);
    logger.info('Seed ejecutado sobre PostgreSQL');
    process.exit(0);
  })().catch((err) => {
    logger.error({ err }, 'Error en seed');
    process.exit(1);
  });
}
