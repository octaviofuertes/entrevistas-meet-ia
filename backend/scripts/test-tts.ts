import 'dotenv/config';
import { GeminiTTS } from '../src/services/tts/gemini';
import { MockTTS } from '../src/services/tts/mock';

async function checkLamejs() {
  try {
    const mod: any = await import('@breezystack/lamejs');
    const ctor = mod.Mp3Encoder ?? mod.default?.Mp3Encoder;
    return { ok: !!ctor, keys: Object.keys(mod), hasMp3Encoder: !!ctor };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

async function main() {
  console.log('=== ENV ===');
  console.log('GEMINI_API_KEY set:', !!process.env.GEMINI_API_KEY, 'len:', (process.env.GEMINI_API_KEY ?? '').length);
  console.log('GEMINI_TTS_MODEL:', process.env.GEMINI_TTS_MODEL);
  console.log('GEMINI_TTS_VOICE:', process.env.GEMINI_TTS_VOICE);
  console.log('TTS_DRIVER:', process.env.TTS_DRIVER);

  console.log('\n=== LAMEJS ENCODER CHECK ===');
  const lame = await checkLamejs();
  console.log(JSON.stringify(lame, null, 2));

  console.log('\n=== MOCK TTS OUTPUT (baseline) ===');
  const mock = new MockTTS();
  const mockOut = await mock.synthesize('Hola, este es un test.');
  console.log('mimeType:', mockOut.mimeType);
  console.log('base64 length:', mockOut.audioBase64.length);
  console.log('first 20 chars:', mockOut.audioBase64.slice(0, 20));
  console.log('bytes:', mockOut.bytes);
  console.log('durationMs:', mockOut.durationMs);

  console.log('\n=== RAW GEMINI HTTP CALL ===');
  const model = process.env.GEMINI_TTS_MODEL ?? 'gemini-2.5-flash-preview-tts';
  const voice = process.env.GEMINI_TTS_VOICE ?? 'Kore';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY ?? '')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'Hola, este es un test.' }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
  });
  console.log('HTTP status:', res.status);
  const bodyText = await res.text();
  console.log('Body (first 1500 chars):', bodyText.slice(0, 1500));

  console.log('\n=== GEMINI TTS CALL (via class) ===');
  const tts = new GeminiTTS();
  const t0 = Date.now();
  const out = await tts.synthesize('Hola, este es un test.');
  const dt = Date.now() - t0;
  console.log('elapsed ms:', dt);
  console.log('mimeType:', out.mimeType);
  console.log('base64 length:', out.audioBase64.length);
  console.log('first 20 chars:', out.audioBase64.slice(0, 20));
  console.log('bytes:', out.bytes);
  console.log('durationMs:', out.durationMs);

  console.log('\n=== ANALYSIS ===');
  const isFallback = out.audioBase64 === mockOut.audioBase64;
  console.log('Identical to mock output?:', isFallback);
  const buf = Buffer.from(out.audioBase64, 'base64');
  console.log('first 16 bytes (hex):', buf.subarray(0, 16).toString('hex'));
  console.log('first 4 bytes (ascii):', JSON.stringify(buf.subarray(0, 4).toString('ascii')));
  const hasID3 = buf.subarray(0, 3).toString('ascii') === 'ID3';
  const hasMpegSync = buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
  console.log('has ID3 header?:', hasID3);
  console.log('has MPEG sync (0xFFEx)?:', hasMpegSync);
  console.log('Verdict:', isFallback ? 'FELL BACK TO MOCK' : (hasID3 || hasMpegSync) ? 'LOOKS LIKE REAL MP3' : 'UNKNOWN FORMAT');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
