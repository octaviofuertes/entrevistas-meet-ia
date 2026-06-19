import { config } from '../../config';
import { logger } from '../../logger';
import { MockTTS } from './mock';
import { ElevenLabsTTS } from './elevenlabs';
import { GeminiTTS } from './gemini';

export interface TTSResult {
  audioBase64: string;
  mimeType: string;
  durationMs: number;
  bytes: number;
}

export interface TTSService {
  synthesize(text: string, opts?: { voiceId?: string }): Promise<TTSResult>;
}

let instance: TTSService | null = null;

export function getTTS(): TTSService {
  if (instance) return instance;

  if (config.TTS_DRIVER === 'gemini') {
    if (!config.GEMINI_API_KEY) {
      logger.warn('TTS_DRIVER=gemini pero GEMINI_API_KEY vacío. Usando mock.');
      instance = new MockTTS();
    } else {
      logger.info(
        { model: config.GEMINI_TTS_MODEL, voice: config.GEMINI_TTS_VOICE },
        'TTS: Gemini activo'
      );
      instance = new GeminiTTS();
    }
  } else if (config.TTS_DRIVER === 'elevenlabs') {
    if (!config.ELEVENLABS_API_KEY) {
      logger.warn('TTS_DRIVER=elevenlabs pero ELEVENLABS_API_KEY vacío. Usando mock.');
      instance = new MockTTS();
    } else {
      logger.info({ voiceId: config.ELEVENLABS_VOICE_ID }, 'TTS: ElevenLabs activo');
      instance = new ElevenLabsTTS();
    }
  } else {
    logger.info('TTS en modo mock');
    instance = new MockTTS();
  }
  return instance;
}
