import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withTimeout } from './index';

const mocks = vi.hoisted(() => ({
  constructorCalls: { count: 0 },
  setMetadata: vi.fn().mockResolvedValue(undefined),
  // Por default, el stream se "cuelga": registra listeners pero nunca emite
  // 'end' ni 'error' — reproduce el escenario (b) del hallazgo real.
  toStreamImpl: { fn: (_text: string) => ({ on: (_event: string, _cb: unknown) => {} }) },
}));

vi.mock('msedge-tts', () => {
  class MockMsEdgeTTS {
    constructor() {
      mocks.constructorCalls.count++;
    }
    setMetadata(...args: unknown[]) {
      return mocks.setMetadata(...args);
    }
    toStream(text: string) {
      return mocks.toStreamImpl.fn(text);
    }
  }
  return {
    MsEdgeTTS: MockMsEdgeTTS,
    OUTPUT_FORMAT: { AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'audio-24khz-48kbitrate-mono-mp3' },
  };
});

import { EdgeTTS } from './edge';

describe('withTimeout', () => {
  it('resuelve con el valor si la promesa termina antes del límite', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 1000, 'test');
    expect(result).toBe('ok');
  });

  it('rechaza con mensaje que contiene "timeout" si la promesa nunca resuelve', async () => {
    vi.useFakeTimers();
    try {
      const neverResolves = new Promise(() => {});
      const assertion = expect(withTimeout(neverResolves, 1000, 'test')).rejects.toThrow(/timeout/);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('EdgeTTS robustez (msedge-tts mockeado)', () => {
  beforeEach(() => {
    mocks.constructorCalls.count = 0;
    mocks.toStreamImpl.fn = () => ({ on: () => {} });
  });

  it('un stream que nunca emite "end" no cuelga: degrada al mock silente tras el timeout', async () => {
    const edge = new EdgeTTS('es-AR-ElenaNeural', 50);
    const result = await edge.synthesize('hola, ¿cómo estás?');
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.audioBase64.length).toBeGreaterThan(0);
  });

  it('tras la falla, el cliente zombie se descarta: la próxima síntesis reconstruye el cliente', async () => {
    const edge = new EdgeTTS('es-AR-ElenaNeural', 50);
    await edge.synthesize('primera');
    expect(mocks.constructorCalls.count).toBe(1);
    await edge.synthesize('segunda');
    expect(mocks.constructorCalls.count).toBe(2);
  });
});
