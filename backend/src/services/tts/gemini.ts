import { config } from '../../config';
import { logger } from '../../logger';
import type { TTSService, TTSResult } from './index';
import { MockTTS } from './mock';

/**
 * Driver TTS usando la voz nativa de Gemini.
 *
 * Modelo: gemini-2.5-pro-preview-tts (configurable).
 * Voces (prebuilt): Kore, Aoede, Puck, Charon, Fenrir, Leda, Orus, Zephyr, etc.
 *
 * Endpoint: POST /v1beta/models/{model}:generateContent
 * Gemini devuelve PCM raw 16-bit LE 24kHz mono. Lo codificamos a MP3 con lamejs
 * porque /output_audio de Recall espera kind:'mp3'. Recall hace su propia
 * decodificación nativa antes de stremear al Meet, así que no hay glitches.
 *
 * Si la API falla cae al MockTTS para no romper la entrevista.
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
      const wav = pcmToWav(pcm, rate);

      const durationMs = Math.round((pcm.length / 2 / rate) * 1000);

      return {
        audioBase64: wav.toString('base64'),
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
  const m = mime.match(/rate=(\d+)/i);
  if (m) return parseInt(m[1], 10);
}

/**
 * Envuelve PCM 16-bit LE mono en un header WAV (RIFF/PCM, 44 bytes).
 * Sin compresión, sin pérdida — el <audio> nativo del Chrome del bot lo
 * reproduce limpio sin glitches de decodificación.
 */
function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
