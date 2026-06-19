import type { TTSService, TTSResult } from './index';

/**
 * Mock TTS: devuelve un MP3 silente mínimo y la duración estimada
 * según la cantidad de palabras (180 wpm).
 *
 * El frontend puede usar audioBase64 con un <audio> sin que truene,
 * y el flujo end-to-end sigue funcionando.
 */
export class MockTTS implements TTSService {
  // Frame MP3 mínimo (~26 ms de silencio). Repetido luego N veces para llegar a la duración objetivo.
  private silentFrameBase64 = 'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQwAAAAAAAAAAAAAAAAAAAAAAA';

  async synthesize(text: string): Promise<TTSResult> {
    const words = text.split(/\s+/).filter(Boolean).length;
    const durationMs = Math.max(1200, Math.round((words / 180) * 60 * 1000));
    return {
      audioBase64: this.silentFrameBase64,
      mimeType: 'audio/mpeg',
      durationMs,
      bytes: Math.round((this.silentFrameBase64.length * 3) / 4),
    };
  }
}
