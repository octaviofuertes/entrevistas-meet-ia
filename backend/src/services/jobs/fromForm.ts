import { v4 as uuid } from 'uuid';
import { config } from '../../config';
import { getLeia } from '../leia';
import { ALL_DIMENSIONS } from '../../types';
import type { Job, JobPreferences, JobModality, JobHiringStatus } from '../../types';

export interface JobFormInput {
  title: string;
  company?: string;
  description: string;
  knowledge: string; // conocimientos que debe tener la persona
  location?: string;
  salary?: string;
  modality?: JobModality;
  vacancies?: number;
  hiringStatus?: JobHiringStatus;
  publishedAt?: string; // ISO date (fecha de publicación)
  language?: string;
  preferences?: Partial<JobPreferences>;
}

/**
 * Crea un Job a partir de los datos cargados en el formulario.
 * La IA (leIA) estructura el stack/seniority/responsabilidades desde el texto;
 * el resto de la metadata se guarda tal cual para que leIA tenga todo el contexto.
 */
export async function buildJobFromForm(input: JobFormInput): Promise<Job> {
  const language = input.language ?? config.INTERVIEW_LANGUAGE;
  const leia = getLeia();

  const structure = await leia.structureJob({
    title: input.title,
    description: input.description,
    knowledge: input.knowledge,
    language,
  });

  const preferences: JobPreferences = {
    durationMinutes: input.preferences?.durationMinutes ?? 20,
    dimensionsToCover: input.preferences?.dimensionsToCover ?? ALL_DIMENSIONS,
    toneOfVoice: input.preferences?.toneOfVoice ?? 'cercano',
    generateReport1: input.preferences?.generateReport1 ?? true,
    generateReport2: input.preferences?.generateReport2 ?? true,
    behavioralAnalysisEnabled: true,
  };

  const now = new Date().toISOString();
  return {
    id: uuid(),
    sourceLink: 'form',
    title: input.title.trim(),
    company: (input.company ?? '').trim(),
    description: input.description.trim(),
    requirements: {
      stack: structure.stack,
      seniority: structure.seniority,
      yearsOfExperience: structure.yearsOfExperience,
      responsibilities: structure.responsibilities,
      niceToHave: structure.niceToHave,
      language,
    },
    preferences,
    rawText: input.knowledge?.trim() || null,
    publishedAt: input.publishedAt ?? now,
    location: input.location?.trim() || null,
    salary: input.salary?.trim() || null,
    vacancies: typeof input.vacancies === 'number' ? input.vacancies : null,
    modality: input.modality ?? null,
    hiringStatus: input.hiringStatus ?? 'abierto',
    createdAt: now,
    updatedAt: now,
  };
}
