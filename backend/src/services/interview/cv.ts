import pdfParse from 'pdf-parse';
import { logger } from '../../logger';

export async function extractCvText(buffer: Buffer): Promise<string | null> {
  try {
    const result = await pdfParse(buffer);
    const text = result.text?.trim();
    return text && text.length > 0 ? text : null;
  } catch (err) {
    logger.warn({ err }, 'No se pudo extraer texto del CV, la entrevista continúa sin este contexto');
    return null;
  }
}
