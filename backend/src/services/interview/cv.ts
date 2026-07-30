import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { logger } from '../../logger';

/** Formatos aceptados por el pipeline de parsing de CVs (RF-03). */
export type CvFormat = 'pdf' | 'docx' | 'text';

/**
 * Detecta el formato real por los magic bytes del archivo (no por la
 * extensión, que el navegador no siempre manda bien):
 *   %PDF  → PDF          ·   PK\x03\x04 → OOXML (.docx)
 */
export function detectCvFormat(buffer: Buffer, fileName = ''): CvFormat {
  if (buffer.length >= 4) {
    if (buffer.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
    if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
      return 'docx';
    }
  }
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'docx';
  return 'text';
}

/**
 * pdf-parse (build viejo de pdf.js) mantiene estado global: invocarlo en
 * paralelo hace que las llamadas se pisen entre sí y fallen con errores
 * espurios ("bad XRef entry", "Invalid number"). Como RF-03 exige subir LOTES
 * de CVs, serializamos las extracciones de PDF en una cadena de promesas.
 */
let pdfQueue: Promise<unknown> = Promise.resolve();

function parsePdfSerialized(buffer: Buffer): Promise<string | null> {
  const run = pdfQueue.then(
    () => pdfParse(buffer).then((r) => clean(r.text)),
    () => pdfParse(buffer).then((r) => clean(r.text))
  );
  // La cola avanza pase lo que pase, para que un CV roto no bloquee al resto.
  pdfQueue = run.catch(() => undefined);
  return run;
}

/**
 * RF-03 — Extrae el texto plano de un CV en PDF o Word (.docx).
 * Devuelve null si no se pudo obtener texto (p. ej. PDF escaneado sin OCR).
 */
export async function extractCvText(buffer: Buffer, fileName = ''): Promise<string | null> {
  const format = detectCvFormat(buffer, fileName);
  try {
    if (format === 'docx') {
      const result = await mammoth.extractRawText({ buffer });
      return clean(result.value);
    }
    if (format === 'pdf') {
      return await parsePdfSerialized(buffer);
    }
    // Formato no soportado (RF-03 cubre PDF y Word): no inventamos contenido.
    return null;
  } catch (err) {
    logger.warn(
      { err, format, fileName },
      'No se pudo extraer texto del CV, la entrevista continúa sin este contexto'
    );
    return null;
  }
}

function clean(raw: string | undefined): string | null {
  const text = (raw ?? '').replace(/\r/g, '').trim();
  return text.length > 0 ? text : null;
}
