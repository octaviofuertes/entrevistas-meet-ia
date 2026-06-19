import { config } from '../../config';
import { logger } from '../../logger';
import type { TTSService, TTSResult } from './index';
import { MockTTS } from './mock';
import { Mp3Encoder } from 'lamejs';

/**
 * Driver TTS usando la voz nativa de Gemini.
 *
 * Modelo: gemini-2.5-flash-preview-tts (configurable).
 * Voces (prebuilt): Kore, Aoede, Puck, Charon, Fenrir, Leda, Orus, Zephyr, etc.
 *
 * Endpoint: POST /v1beta/models/{model}:generateContent
 * Devuelve PCM raw 16-bit LE 24kHz mono → lo envolvemos en WAV (44 bytes de header).
 *
 * Si la API falla (rate limit, etc.), cae al MockTTS para no romper la entrevista.
 */
export class GeminiTTS implements TTSService {
  private fallback = new MockTTS();

  async synthesize(text: string, opts?: { voiceId?: string }): Promise<TTSResult> {
    const voiceName = (opts?.voiceId ?? config.GEMINI_TTS_VOICE).trim();
    const model = config.GEMINI_TTS_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
      config.GEMINI_API_KEY
    )}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Gemini TTS ${res.status}: ${body.slice(0, 300)}`);
      }

      const data = (await res.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              inlineData?: { mimeType?: string; data?: string };
            }>;
          };
        }>;
      };

      const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      const pcmBase64 = part?.inlineData?.data;
      const sourceMime = part?.inlineData?.mimeType ?? '';
      if (!pcmBase64) throw new Error('Gemini TTS: respuesta sin audio');

      const rate = parseRateFromMime(sourceMime) ?? 24000;
      const pcm = Buffer.from(pcmBase64, 'base64');
      const mp3 = encodePcmMonoToMp3(pcm, rate);
      const audioBase64 = mp3.toString('base64');

      // Duración real desde el tamaño del PCM (16-bit mono).
      const durationMs = Math.round((pcm.length / 2 / rate) * 1000);

      return {
        audioBase64,
        mimeType: 'audio/mpeg',
        durationMs: Math.max(800, durationMs),
        bytes: mp3.length,
      };
    } catch (err) {
      logger.warn({ err }, 'gemini.tts: fallback a mock');
      return this.fallback.synthesize(text);
    }
  }
}

function parseRateFromMime(mime: string): number | undefined {
  // Ej: "audio/L16;codec=pcm;rate=24000"
  const m = mime.match(/rate=(\d+)/i);
  if (m) return parseInt(m[1], 10);
}

/**
 * Envuelve PCM raw (16-bit LE, mono) en un WAV mínimo con header RIFF de 44 bytes.
 * Recall.ai, Chrome, ffmpeg y los players nativos lo aceptan sin problema.
 */
function encodePcmMonoToMp3(pcm: Buffer, sampleRate: number): Buffer {
  const samples = new Int16Array(Math.floor(pcm.length / 2));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = pcm.readInt16LE(i * 2);
  }

  const encoder = new Mp3Encoder(1, sampleRate, 64);
  const chunks: Buffer[] = [];
  const frameSize = 1152;

  for (let i = 0; i < samples.length; i += frameSize) {
    const frame = samples.subarray(i, i + frameSize);
    const encoded = encoder.encodeBuffer(frame);
    if (encoded.length > 0) chunks.push(Buffer.from(encoded));
  }

  const flushed = encoder.flush();
  if (flushed.length > 0) chunks.push(Buffer.from(flushed));

  return Buffer.concat(chunks);
}
