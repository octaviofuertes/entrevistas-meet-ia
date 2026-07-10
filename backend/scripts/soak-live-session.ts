/**
 * Soak test de ETAPA1-CIERRE (AC-NEW-04) — sostiene una sesión REAL de
 * Gemini Live por >=12 minutos (cruza el límite documentado de ~10 min de
 * conexión) usando la clase VoiceSession real (no una copia de su config),
 * para verificar con evidencia si session resumption + context window
 * compression + la reconexión de VoiceSession sostienen la sesión.
 *
 * No forma parte de la suite de tests ni del build de producción.
 * Requiere GEMINI_API_KEY de tier pago en el entorno, y ffmpeg en PATH
 * (para convertir el audio sintetizado con Edge TTS a PCM 16kHz de entrada).
 *
 * Uso: cd backend && npx tsx scripts/soak-live-session.ts
 * Variable opcional: SOAK_MINUTES (default 13).
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { VoiceSession } from '../src/services/voice/live-session';
import type { Job, Candidate } from '../src/types';

if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

if (!process.env.GEMINI_API_KEY) {
  console.error('Falta GEMINI_API_KEY en el entorno.');
  process.exit(1);
}

const SOAK_MINUTES = Number(process.env.SOAK_MINUTES ?? 13);
const TURN_INTERVAL_MS = 90_000;

function runFfmpegPipe(input: Buffer, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    const chunks: Buffer[] = [];
    proc.stdout.on('data', (d: Buffer) => chunks.push(d));
    proc.stderr.on('data', () => {});
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg salió con código ${code}`));
    });
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

async function synthesizePacedPCM16k(text: string): Promise<Buffer> {
  const mod: any = await import('msedge-tts');
  const Ctor = mod.MsEdgeTTS ?? mod.default?.MsEdgeTTS ?? mod.default;
  const client = new Ctor();
  const OUTPUT = mod.OUTPUT_FORMAT ?? mod.default?.OUTPUT_FORMAT;
  await client.setMetadata('es-AR-ElenaNeural', OUTPUT?.AUDIO_24KHZ_48KBITRATE_MONO_MP3 ?? 'audio-24khz-48kbitrate-mono-mp3');
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const stream = client.toStream(text);
    const audioStream = stream.audioStream ?? stream;
    audioStream.on('data', (d: Buffer) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    audioStream.on('end', () => resolve());
    audioStream.on('error', reject);
  });
  const mp3 = Buffer.concat(chunks);
  return runFfmpegPipe(mp3, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 's16le', '-ar', '16000', '-ac', '1', 'pipe:1']);
}

/** Envía el PCM pausado a tiempo real (16kHz*16bit*mono = 32000 bytes/seg), como en producción. */
async function sendPaced(session: VoiceSession, pcm: Buffer) {
  const BYTES_PER_SEC = 32000;
  const CHUNK_MS = 100;
  const chunkSize = Math.floor((BYTES_PER_SEC * CHUNK_MS) / 1000);
  for (let i = 0; i < pcm.length; i += chunkSize) {
    session.sendCandidateAudio(pcm.subarray(i, i + chunkSize));
    await new Promise((r) => setTimeout(r, CHUNK_MS));
  }
}

const job: Job = {
  id: 'soak-job',
  sourceLink: 'form',
  title: 'QA Automation Semi',
  company: 'Acme QA',
  description: 'Soak test',
  requirements: { stack: ['Cypress'], seniority: 'semi', yearsOfExperience: 3, responsibilities: [], niceToHave: [], language: 'es' },
  preferences: { durationMinutes: 20, dimensionsToCover: ['tecnicos', 'experiencia'], toneOfVoice: 'cercano', generateReport1: false, generateReport2: false },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const candidate: Candidate = {
  id: 'soak-candidate',
  email: 'soak@example.com',
  name: 'Candidato Soak',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const phrases = [
  'Tengo experiencia con Cypress y Playwright en proyectos de automatización.',
  'Trabajé con integración continua usando GitHub Actions.',
  'Me tocó liderar la migración de Selenium a Playwright en mi último trabajo.',
  'Suelo escribir tests end to end y también pruebas de contrato entre servicios.',
  'Me gusta mucho la parte de performance testing con k6.',
  'En el equipo anterior armamos un dashboard de métricas de calidad.',
  'Tengo ganas de seguir creciendo en el área de QA automation.',
  'Me interesa particularmente el testing de APIs con contratos OpenAPI.',
  'También hice bastante trabajo de mentoría a QAs junior.',
];

async function main() {
  const events: Array<{ t: number; kind: string; detail?: unknown }> = [];
  const log = (kind: string, detail?: unknown) => {
    const t = Date.now();
    events.push({ t, kind, detail });
    console.log(`[+${((t - startedAt) / 1000).toFixed(1)}s] ${kind}`, detail ?? '');
  };

  let audioCount = 0;
  let lastAudioAt = 0;
  let closed = false;
  let closedCode: number | undefined;

  const session = new VoiceSession({
    onAudio: (_wav, durationMs) => {
      audioCount++;
      lastAudioAt = Date.now();
      log('audio', { durationMs });
    },
    onOutputTranscript: () => {},
    onInputTranscript: () => {},
    onTurnComplete: () => log('turnComplete'),
    onInterrupted: () => log('interrupted'),
    onError: (err) => log('error', err.message),
    onClose: (code, reason) => {
      closed = true;
      closedCode = code;
      log('close', { code, reason });
    },
  });

  const startedAt = Date.now();
  log('start', { soakMinutes: SOAK_MINUTES });

  await session.connectAndGreet(job, candidate, null);
  log('connected');

  const endAt = startedAt + SOAK_MINUTES * 60_000;
  let turnIdx = 0;
  while (Date.now() < endAt) {
    await new Promise((r) => setTimeout(r, TURN_INTERVAL_MS));
    if (closed) {
      log('detectado-cierre-durante-el-soak');
      break;
    }
    const phrase = phrases[turnIdx % phrases.length];
    turnIdx++;
    try {
      const pcm = await synthesizePacedPCM16k(phrase);
      log('enviando-turno', { turnIdx, phrase });
      await sendPaced(session, pcm);
    } catch (err) {
      log('error-sintetizando-turno', String(err));
    }
  }

  // Chequeo final: ¿la sesión (original o reconectada) sigue respondiendo?
  let respondedAtEnd = false;
  if (!closed) {
    const audioBefore = audioCount;
    session.sendTextInstruction('Decime una palabra cualquiera para confirmar que seguís escuchando.');
    await new Promise((r) => setTimeout(r, 8000));
    respondedAtEnd = audioCount > audioBefore;
    log('chequeo-final', { respondedAtEnd });
  }

  session.close();
  await new Promise((r) => setTimeout(r, 1000));

  const summary = {
    soakMinutes: SOAK_MINUTES,
    durationMs: Date.now() - startedAt,
    audioChunksTotal: audioCount,
    lastAudioAgoMs: lastAudioAt ? Date.now() - lastAudioAt : null,
    closedDuringSoak: closed,
    closedCode,
    respondedAtEnd,
    eventos: events.map((e) => ({ tSec: ((e.t - startedAt) / 1000).toFixed(1), kind: e.kind, detail: e.detail })),
  };
  console.log('\n=== RESUMEN SOAK ===');
  console.log(JSON.stringify(summary, null, 2));

  const sostenida = !closed && (respondedAtEnd || audioCount > 0);
  process.exit(sostenida ? 0 : 1);
}

main().catch((err) => {
  console.error('soak: error fatal', err);
  process.exit(1);
});
