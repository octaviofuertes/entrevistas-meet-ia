import { config } from '../../config';
import { logger } from '../../logger';
import type { TTSDriver } from '../../types';
import { MockTTS } from './mock';
import { ElevenLabsTTS } from './elevenlabs';
import { GeminiTTS } from './gemini';
import { EdgeTTS } from './edge';

export interface TTSResult {
  audioBase64: string;
  mimeType: string;
  durationMs: number;
  bytes: number;
}

export interface TTSService {
  synthesize(text: string, opts?: { voiceId?: string }): Promise<TTSResult>;
}

const instances = new Map<TTSDriver, TTSService>();

export function getTTS(driver: TTSDriver = config.TTS_DRIVER): TTSService {
  const selected = normalizeDriver(driver);
  const cached = instances.get(selected);
  if (cached) return cached;

  let instance: TTSService;
  if (selected === 'edge') {
    logger.info('TTS: Microsoft Edge activo');
    instance = new EdgeTTS();
  } else if (selected === 'gemini') {
    if (!config.GEMINI_API_KEY) {
      logger.warn('TTS_DRIVER=gemini pero GEMINI_API_KEY vacio. Usando mock.');
      instance = new MockTTS();
    } else {
      logger.info(
        { model: config.GEMINI_TTS_MODEL, voice: config.GEMINI_TTS_VOICE },
        'TTS: Gemini activo'
      );
      instance = new GeminiTTS();
    }
  } else if (selected === 'elevenlabs') {
    if (!config.ELEVENLABS_API_KEY) {
      logger.warn('TTS_DRIVER=elevenlabs pero ELEVENLABS_API_KEY vacio. Usando mock.');
      instance = new MockTTS();
    } else {
      logger.info({ voiceId: config.ELEVENLABS_VOICE_ID }, 'TTS: ElevenLabs activo');
      instance = new ElevenLabsTTS();
    }
  } else {
    logger.info('TTS en modo mock');
    instance = new MockTTS();
  }

  instances.set(selected, instance);
  return instance;
}

function normalizeDriver(driver: TTSDriver): TTSDriver {
  if (driver === 'edge' || driver === 'gemini' || driver === 'elevenlabs') return driver;
  return 'mock';
}
