import { config } from '../../config';
import { logger } from '../../logger';
import type { TTSService, TTSResult } from './index';
import { MockTTS } from './mock';

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
      const wav = wrapPcmAsWav(pcm, rate);
      const audioBase64 = wav.toString('base64');

      // Duración real desde el tamaño del PCM (16-bit mono).
      const durationMs = Math.round((pcm.length / 2 / rate) * 1000);

      return {
        audioBase64,
        mimeType: 'audio/wav',
        durationMs: Math.max(800, durationMs),
        bytes: wav.length,
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
function wrapPcmAsWav(pcm: Buffer, sampleRate: number): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcm.length;
  const fileSize = 36 + dataSize;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(fileSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);            // PCM chunk size
  header.writeUInt16LE(1, 20);             // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}
