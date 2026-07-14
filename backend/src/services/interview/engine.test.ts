import { describe, it, expect } from 'vitest';
import { v4 as uuid } from 'uuid';
import { MemoryDb } from '../../db/memory';
import {
  InterviewEngine,
  disposeEngine,
  findSimilarQuestion,
  splitSentences,
  isNeutralFiller,
} from './engine';
import { getRecall } from '../recall';
import { getBrowserRecall } from '../recall/browser';
import type { Job, Candidate, Interview } from '../../types';
import { ALL_DIMENSIONS } from '../../types';

/**
 * Tests de caracterización (T04, Etapa 0): fijan el comportamiento REAL y
 * actual del engine con los drivers mock (LEIA_DRIVER/RECALL_DRIVER/TTS_DRIVER
 * = mock, tomados de backend/.env). No son tests de comportamiento deseado:
 * documentan lo que el sistema hace hoy.
 */

function buildJob(overrides?: Partial<Job>): Job {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    sourceLink: 'https://demo.test/job',
    title: 'Frontend React Semi',
    company: 'Test Co',
    description: 'Puesto de prueba',
    requirements: {
      stack: ['React', 'TypeScript'],
      seniority: 'semi',
      yearsOfExperience: 3,
      responsibilities: ['Desarrollo de features'],
      niceToHave: [],
      language: 'es',
    },
    preferences: {
      durationMinutes: 20,
      dimensionsToCover: ALL_DIMENSIONS,
      toneOfVoice: 'cercano',
      generateReport1: false,
      generateReport2: false,
    },
    rawText: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildCandidate(): Candidate {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    email: `candidato-${uuid()}@test.com`,
    name: 'Ana Pérez',
    createdAt: now,
    updatedAt: now,
  };
}

function buildInterview(jobId: string, candidateId: string, mode: 'meet' | 'browser'): Interview {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    jobId,
    candidateId,
    status: 'agendada',
    mode,
    meetUrl: mode === 'meet' ? 'https://meet.google.com/abc-defg-hij' : '',
    createdAt: now,
    updatedAt: now,
  };
}

async function setup(mode: 'meet' | 'browser', jobOverrides?: Partial<Job>) {
  const db = new MemoryDb();
  const job = buildJob(jobOverrides);
  const candidate = buildCandidate();
  const interview = buildInterview(job.id, candidate.id, mode);
  await db.createJob(job);
  await db.createCandidate(candidate);
  await db.createInterview(interview);
  const engine = new InterviewEngine(db, interview.id);
  return { db, job, candidate, interview, engine };
}

/**
 * En modo meet, mientras leIA "habla" el saludo (audio pre-sintetizado, ver
 * `audio_generated`), el engine ignora los captions del candidato como eco
 * (half-duplex). Para poder simular una respuesta real hay que esperar a que
 * esa ventana termine — se mide con el durationMs real del evento (hay que
 * suscribirse ANTES de `start()`, porque el evento se emite durante esa
 * llamada), no con un número fijo: el saludo mock de este puesto de prueba
 * ronda los 14s (MockTTS estima ~333ms por palabra).
 */
function captureNextAudioDurationMs(engine: InterviewEngine): Promise<number> {
  return new Promise((resolve) => {
    const handler = (evt: any) => {
      if (evt.type === 'audio_generated') {
        engine.events.off('event', handler);
        resolve(evt.payload.durationMs);
      }
    };
    engine.events.on('event', handler);
  });
}

describe('InterviewEngine — caracterización (drivers mock)', () => {
  it('modo meet: commitea la respuesta tras SILENCE_MS de silencio real', async () => {
    const { db, interview, engine } = await setup('meet');
    const audioDurationMs = captureNextAudioDurationMs(engine);
    await engine.start();
    const durationMs = await audioDurationMs;
    await new Promise((r) => setTimeout(r, durationMs + 600));

    await engine.simulateCandidateAnswer(
      'Trabajé con React y TypeScript en un e-commerce durante tres años, liderando el frontend.'
    );

    // SILENCE_MS(700) + sleep variable del mock.evaluate (hasta 700) + margen.
    await new Promise((r) => setTimeout(r, 1800));

    const turns = await db.listTurns(interview.id);
    expect(turns.length).toBeGreaterThanOrEqual(1);
    expect(turns[0].answerTranscript).toContain('React y TypeScript');

    const evaluations = await db.listEvaluations(interview.id);
    expect(evaluations.length).toBe(1);
    expect(evaluations[0].score).toBeGreaterThanOrEqual(0);
    expect(evaluations[0].score).toBeLessThanOrEqual(10);

    disposeEngine(interview.id);
    engine.dispose();
  }, 20000);

  it('modo meet: ignora como respuesta el caption del candidato mientras leIA habla (eco)', async () => {
    const { db, interview, engine } = await setup('meet');
    await engine.start();

    // Justo después de start(), el saludo se está "reproduciendo" (preTtsAudio
    // del mock TTS dura al menos 1200ms) → botSpeakingUntilMs sigue vigente.
    await engine.simulateCandidateAnswer('esto es mi propio eco reproducido');

    await new Promise((r) => setTimeout(r, 1100));

    const turns = await db.listTurns(interview.id);
    // El turno inicial sigue sin respuesta: el caption se ignoró como buffer
    // de respuesta (aunque haya quedado persistido en transcripts).
    expect(turns[0].answerTranscript).toBe('');

    const transcripts = await db.listTranscripts(interview.id);
    expect(transcripts.some((t) => t.text.includes('esto es mi propio eco'))).toBe(true);

    disposeEngine(interview.id);
    engine.dispose();
  }, 10000);

  it('modo browser: el caption del candidato SÍ alimenta la respuesta aunque leIA esté hablando', async () => {
    const { db, interview, engine } = await setup('browser');
    await engine.start();

    const browserRecall = getBrowserRecall(interview.id);
    browserRecall.ingestCaption('Tengo experiencia con Next.js y Tailwind en proyectos reales', true);

    await new Promise((r) => setTimeout(r, 1800));

    const turns = await db.listTurns(interview.id);
    expect(turns[0].answerTranscript).toContain('Next.js');

    disposeEngine(interview.id);
    engine.dispose();
  }, 10000);

  it('respuesta vacía/muy corta dispara aclaración sin avanzar turnIndex', async () => {
    const { db, interview, engine } = await setup('meet');
    const audioDurationMs = captureNextAudioDurationMs(engine);
    await engine.start();
    const durationMs = await audioDurationMs;
    await new Promise((r) => setTimeout(r, durationMs + 600));

    await engine.simulateCandidateAnswer('eh');

    await new Promise((r) => setTimeout(r, 1800));

    const turns = await db.listTurns(interview.id);
    // Turno 0 (aclaración) + turno 1 (la re-pregunta, sigue índice 0 porque
    // isClarification=true no incrementa turnIndex).
    expect(turns.length).toBe(2);
    expect(turns[0].index).toBe(0);
    expect(turns[1].index).toBe(0);

    disposeEngine(interview.id);
    engine.dispose();
  }, 20000);

  it('auto-finaliza la entrevista cuando el candidato abandona, y stop() es idempotente', async () => {
    const { db, interview, engine } = await setup('meet');
    await engine.start();

    const recall = getRecall();
    recall.events.emit('event', {
      type: 'participant_left',
      payload: { interviewId: interview.id, botId: 'bot_x', speaker: 'candidate' },
    });

    // AUTO_FINISH_DELAY_MS(4000) + margen.
    await new Promise((r) => setTimeout(r, 4400));

    const after1 = await db.getInterview(interview.id);
    expect(after1?.status).toBe('completada');
    const endedAt1 = after1?.endedAt;
    expect(endedAt1).toBeTruthy();

    // Segunda llamada manual: no debe re-disparar la transición ni cambiar endedAt.
    await engine.stop('manual');
    const after2 = await db.getInterview(interview.id);
    expect(after2?.endedAt).toBe(endedAt1);

    disposeEngine(interview.id);
    engine.dispose();
  }, 10000);
});

describe('findSimilarQuestion (guard anti-repetición, umbral Jaccard 0.6)', () => {
  it('detecta una pregunta muy similar (Jaccard >= 0.6)', () => {
    const previas = ['¿Cómo encarás un problema de performance en React?'];
    const candidata = '¿Cómo encarás un problema de performance en React hoy?';
    expect(findSimilarQuestion(candidata, previas)).toBe(previas[0]);
  });

  it('no detecta similitud cuando el ángulo es distinto (Jaccard < 0.6)', () => {
    const previas = ['¿Cómo encarás un problema de performance en React?'];
    const candidata = '¿Trabajaste alguna vez liderando un equipo distribuido?';
    expect(findSimilarQuestion(candidata, previas)).toBeNull();
  });
});

describe('splitSentences (sentence-streaming TTS)', () => {
  it('texto corto (<=60 chars) se devuelve como un único chunk', () => {
    const text = 'Hola, ¿cómo estás?';
    expect(splitSentences(text)).toEqual([text]);
  });

  it('texto largo multi-oración se divide preservando la puntuación', () => {
    const text =
      'Hola Ana, soy leIA. Vamos a tener una charla de veinte minutos. ¿Contame tu experiencia?';
    const chunks = splitSentences(text);
    expect(chunks.length).toBe(3);
    expect(chunks[0]).toBe('Hola Ana, soy leIA.');
    expect(chunks[1]).toBe('Vamos a tener una charla de veinte minutos.');
    expect(chunks[2]).toBe('¿Contame tu experiencia?');
  });
});

describe('isNeutralFiller (filtro de muletillas)', () => {
  it('rechaza muletillas evaluativas o de transición', () => {
    expect(isNeutralFiller('¡Buenísimo!')).toBe(false);
    expect(isNeutralFiller('Pasemos a otro tema')).toBe(false);
  });

  it('rechaza muletillas largas (más de 5 palabras o 40 caracteres)', () => {
    expect(isNeutralFiller('Esto es una muletilla demasiado larga para ser natural')).toBe(false);
  });

  it('acepta muletillas neutras y cortas', () => {
    expect(isNeutralFiller('Ajá.')).toBe(true);
    expect(isNeutralFiller('Dejame pensar.')).toBe(true);
  });
});
