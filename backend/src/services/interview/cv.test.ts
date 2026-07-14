import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { extractCvText } from './cv';

const SAMPLE_PDF_PATH = path.join(__dirname, 'cv-sample.pdf');

describe('extractCvText', () => {
  it('extrae el texto plano de un PDF válido', async () => {
    const pdf = fs.readFileSync(SAMPLE_PDF_PATH);
    const text = await extractCvText(pdf);
    expect(text).not.toBeNull();
    expect(text).toContain('Hola CV de prueba');
  });

  it('devuelve null (sin lanzar excepción) ante un buffer que no es un PDF', async () => {
    const text = await extractCvText(Buffer.from('esto no es un pdf'));
    expect(text).toBeNull();
  });
});
