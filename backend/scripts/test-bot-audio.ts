import 'dotenv/config';
import { GeminiTTS } from '../src/services/tts/gemini';

const botId = process.argv[2];
if (!botId) {
  console.error('Uso: tsx scripts/test-bot-audio.ts <botId>');
  process.exit(1);
}
const key = process.env.RECALL_API_KEY!;
const region = process.env.RECALL_REGION ?? 'us-east-1';

(async () => {
  const tts = new GeminiTTS();
  const text = 'Esto es un test directo. Si me escuchás, el audio del bot funciona.';
  console.log('Synthesizing:', text);
  const out = await tts.synthesize(text);
  console.log('audio len:', out.audioBase64.length, 'bytes:', out.bytes, 'mime:', out.mimeType);

  console.log('Sending to bot via /output_audio...');
  const res = await fetch(`https://${region}.recall.ai/api/v1/bot/${botId}/output_audio/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Token ${key}` },
    body: JSON.stringify({ kind: 'mp3', b64_data: out.audioBase64 }),
  });
  console.log('status:', res.status);
  const body = await res.text();
  console.log('body:', body.slice(0, 800));
})();
