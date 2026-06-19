import { config } from '../../config';
import { logger } from '../../logger';
import type { TTSService, TTSResult } from './index';
import { MockTTS } from './mock';

/**
 * Driver real de ElevenLabs.
 *
 * Endpoint: POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
 * Devuelve audio/mpeg en bytes. Si falla, cae al mock.
 */
export class ElevenLabsTTS implements TTSService {
  private endpoint = 'https://api.elevenlabs.io/v1/text-to-speech';
  private fallback = new MockTTS();

  async synthesize(text: string, opts?: { voiceId?: string }): Promise<TTSResult> {
    const voiceId = opts?.voiceId ?? config.ELEVENLABS_VOICE_ID;
    try {
      const res = await fetch(`${this.endpoint}/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': config.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: config.ELEVENLABS_MODEL,
          voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.25 },
        }),
      });
      if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
      const arr = new Uint8Array(await res.arrayBuffer());
      const buf = Buffer.from(arr);
      const audioBase64 = buf.toString('base64');
      const words = text.split(/\s+/).filter(Boolean).length;
      return {
        audioBase64,
        mimeType: 'audio/mpeg',
        durationMs: Math.max(1500, words * 320),
        bytes: buf.length,
      };
    } catch (err) {
      logger.warn({ err }, 'TTS ElevenLabs falló, devolviendo audio silente');
      return this.fallback.synthesize(text);
    }
  }
}
