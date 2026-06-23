import { webcrypto } from 'node:crypto';
import { logger } from '../../logger';
import type { TTSService, TTSResult } from './index';
import { MockTTS } from './mock';

// msedge-tts usa globalThis.crypto, que en Node 18 no existe — lo polifileamos.
if (!(globalThis as any).crypto) {
  (globalThis as any).crypto = webcrypto;
}

/**
 * Microsoft Edge Read-Aloud TTS — gratis, sin API key, voces neuronales en
 * múltiples idiomas. Es el mismo servicio que usa la función "Read aloud"
 * del navegador Edge.
 *
 * Voces español:
 *   - es-AR-ElenaNeural   (femenina rioplatense)
 *   - es-AR-TomasNeural   (masculina rioplatense)
 *   - es-MX-DaliaNeural   (femenina MX)
 *   - es-ES-ElviraNeural  (femenina ES)
 *
 * Devuelve MP3 (audio-24khz-48kbitrate-mono-mp3) — formato que Recall acepta
 * sin reservas y el <audio> del browser reproduce nativo.
 */
export class EdgeTTS implements TTSService {
  private fallback = new MockTTS();
  private voiceName: string;
  private clientPromise: Promise<any> | null = null;

  constructor(voice = 'es-AR-ElenaNeural') {
    this.voiceName = voice;
  }

  private async getClient() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const mod: any = await import('msedge-tts');
        const Ctor = mod.MsEdgeTTS ?? mod.default?.MsEdgeTTS ?? mod.default;
        if (!Ctor) throw new Error('msedge-tts: no se encontró MsEdgeTTS');
        const client = new Ctor();
        const OUTPUT = mod.OUTPUT_FORMAT ?? mod.default?.OUTPUT_FORMAT;
        const format = OUTPUT?.AUDIO_24KHZ_48KBITRATE_MONO_MP3
          ?? OUTPUT?.AUDIO_24KHZ_96KBITRATE_MONO_MP3
          ?? 'audio-24khz-48kbitrate-mono-mp3';
        await client.setMetadata(this.voiceName, format);
        return client;
      })();
    }
    return this.clientPromise;
  }

  async synthesize(text: string): Promise<TTSResult> {
    try {
      const client = await this.getClient();
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        const stream = client.toStream(text);
        const onData = (data: Buffer) => chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
        const onEnd = () => resolve();
        const onError = (err: any) => reject(err);
        if (stream && typeof stream.audioStream?.on === 'function') {
          stream.audioStream.on('data', onData);
          stream.audioStream.on('end', onEnd);
          stream.audioStream.on('error', onError);
        } else if (stream && typeof stream.on === 'function') {
          stream.on('data', onData);
          stream.on('end', onEnd);
          stream.on('error', onError);
        } else {
          reject(new Error('msedge-tts: no se pudo obtener stream de audio'));
        }
      });
      const mp3 = Buffer.concat(chunks);
      if (mp3.length < 200) throw new Error(`Edge TTS devolvió ${mp3.length} bytes`);
      const wordsPerSec = 2.8;
      const words = text.split(/\s+/).filter(Boolean).length;
      const durationMs = Math.max(800, Math.round((words / wordsPerSec) * 1000));
      return {
        audioBase64: mp3.toString('base64'),
        mimeType: 'audio/mpeg',
        durationMs,
        bytes: mp3.length,
      };
    } catch (err) {
      logger.warn({ err }, 'edge.tts: fallback a mock');
      return this.fallback.synthesize(text);
    }
  }
}
