import { v4 as uuid } from 'uuid';
import { logger } from '../../logger';
import { getLeia } from '../leia';
import type { Job, JobQuestion } from '../../types';

/**
 * RF-02 — Genera automáticamente el banco de 5 a 10 preguntas del puesto
 * (técnicas del stack, situacionales sobre las responsabilidades y de descarte
 * sobre requisitos excluyentes).
 *
 * Se invoca al guardar el puesto y al pedir una regeneración desde la ficha.
 * Si la IA falla por completo el puesto se guarda igual, sin preguntas, y el
 * reclutador puede regenerarlas desde la UI.
 */
export async function generateQuestionsFor(job: Job): Promise<JobQuestion[]> {
  try {
    const generated = await getLeia().generateJobQuestions({ job });
    return generated.map((q) => ({
      id: uuid(),
      text: q.text,
      kind: q.kind,
      source: 'ia' as const,
    }));
  } catch (err) {
    logger.warn({ err, jobId: job.id }, 'RF-02: no se pudo generar el banco de preguntas');
    return [];
  }
}
