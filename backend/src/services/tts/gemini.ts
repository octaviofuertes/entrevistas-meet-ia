import { config } from '../../config';
import { logger } from '../../logger';
import type { TTSService, TTSResult } from './index';
import { MockTTS } from './mock';
// lamejs es ESM puro, lo cargamos dinámicamente para evitar problemas con tsx/CJS.
let mp3EncoderCtor: any = null;
async function getMp3Encoder() {
  if (!mp3EncoderCtor) {
    const mod: any = await import('@breezystack/lamejs');
    mp3EncoderCtor = mod.Mp3Encoder ?? mod.default?.Mp3Encoder;
    if (!mp3EncoderCtor) throw new Error('No se pudo cargar Mp3Encoder de lamejs');
  }
  return mp3EncoderCtor;
}

/**
 * Driver TTS usando la voz nativa de Gemini.
 *
 * Modelo: gemini-2.5-flash-preview-tts (configurable).
 * Voces (prebuilt): Kore, Aoede, Puck, Charon, Fenrir, Leda, Orus, Zephyr, etc.
 *
 * Endpoint: POST /v1beta/models/{model}:generateContent
 * Gemini devuelve PCM raw 16-bit LE 24kHz mono. Lo codificamos a MP3 con lamejs
 * porque Recall.ai espera MP3 base64 en /output_audio. El browser también lo
 * reproduce sin drama.
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
      const mp3 = await pcmToMp3(pcm, rate);

      const durationMs = Math.round((pcm.length / 2 / rate) * 1000);

      return {
        audioBase64: mp3.toString('base64'),
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
  const m = mime.match(/rate=(\d+)/i);
  if (m) return parseInt(m[1], 10);
}

/**
 * PCM 16-bit LE mono → MP3 (libreria lamejs, sin binarios externos).
 * 24kHz mono a 96 kbps queda con buena calidad para voz.
 */
async function pcmToMp3(pcm: Buffer, sampleRate: number): Promise<Buffer> {
  const Encoder = await getMp3Encoder();
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  const encoder = new Encoder(1, sampleRate, 96);
  const chunkSize = 1152;
  const mp3Data: Uint8Array[] = [];
  for (let i = 0; i < samples.length; i += chunkSize) {
    const chunk = samples.subarray(i, i + chunkSize);
    const encoded = encoder.encodeBuffer(chunk);
    if (encoded.length > 0) mp3Data.push(encoded);
  }
  const flushed = encoder.flush();
  if (flushed.length > 0) mp3Data.push(flushed);
  const total = mp3Data.reduce((a, b) => a + b.length, 0);
  const out = Buffer.alloc(total);
  let offset = 0;
  for (const part of mp3Data) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
