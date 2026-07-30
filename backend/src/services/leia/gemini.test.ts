import { describe, it, expect, vi, afterEach } from 'vitest';
import { GeminiLeia } from './gemini';

/**
 * Job mínimo: buildReport1 del mock (fallback) sólo lee job.title, así que
 * castamos para no construir un Job completo.
 */
const JOB: any = {
  title: 'Frontend Dev',
  company: 'Test Co',
  requirements: { stack: ['React'], language: 'es' },
  preferences: {},
};

describe('GeminiLeia — robustez de red (timeout → fallback al mock)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('buildReport1: un fetch colgado se corta por timeout y cae al mock (no cuelga infinito)', async () => {
    vi.useFakeTimers();
    // fetch que NO resuelve nunca salvo que se aborte la señal: simula una
    // conexión a Gemini que se cuelga (sin respuesta, sin cerrar).
    const fetchStub = vi.fn((_url: any, init: any) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () =>
          rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        );
      })
    );
    vi.stubGlobal('fetch', fetchStub as any);

    const leia = new GeminiLeia();
    const p = leia.buildReport1({
      job: JOB,
      candidateName: 'Ana',
      fullTranscript: [{ speaker: 'candidate', text: 'Trabajé con React durante tres años', atMs: 0 }],
      durationSec: 120,
      language: 'es',
      behavior: null,
      cvText: null,
    });

    // Avanzamos el reloj más allá del timeout (30s): dispara el abort → el helper
    // lanza → buildReport1 cae al mock. Sin el fix, `p` no resolvería nunca.
    await vi.advanceTimersByTimeAsync(31_000);
    const report = await p;

    expect(fetchStub).toHaveBeenCalled();
    expect(report.summary).toBeTruthy(); // el mock produjo un informe válido
    expect(report.fullTranscript.length).toBe(1);
  }, 10000);
});
