import 'dotenv/config';
import { EdgeTTS } from '../src/services/tts/edge';

(async () => {
  const tts = new EdgeTTS('es-AR-ElenaNeural');
  console.log('Sintetizando con Edge TTS (es-AR-ElenaNeural)...');
  const t0 = Date.now();
  const out = await tts.synthesize('Hola, soy leIA. Si estás escuchando esto, el TTS de Microsoft Edge funciona perfectamente.');
  const dt = Date.now() - t0;
  console.log('elapsed ms:', dt);
  console.log('mimeType:', out.mimeType);
  console.log('base64 length:', out.audioBase64.length);
  console.log('bytes:', out.bytes);
  console.log('durationMs:', out.durationMs);
  const buf = Buffer.from(out.audioBase64, 'base64');
  console.log('first 4 bytes (ascii):', JSON.stringify(buf.subarray(0, 4).toString('ascii')));
  const looksReal = out.audioBase64.length > 500;
  console.log('OK =', looksReal);
})();
