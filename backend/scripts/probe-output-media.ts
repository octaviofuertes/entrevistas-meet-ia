import 'dotenv/config';

const key = process.env.RECALL_API_KEY!;
const region = process.env.RECALL_REGION ?? 'us-east-1';
const url = `https://${region}.recall.ai/api/v1/bot/`;

async function probe(label: string, body: any) {
  console.log(`\n=== ${label} ===`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Token ${key}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log('status:', res.status);
  console.log('body:', text.slice(0, 800));
}

const base = {
  bot_name: 'probe',
  meeting_url: 'https://meet.google.com/abc-defg-hij',
  recording_config: { transcript: { provider: { recallai_streaming: {} } } },
};

(async () => {
  // Variante A: output_media.audio (webpage). Si Recall lo acepta, el bot
  // toma sólo el audio de la página, sin tile de cámara.
  await probe('A: output_media.audio webpage', {
    ...base,
    output_media: { audio: { kind: 'webpage', config: { url: 'https://example.com' } } },
  });

  // Variante B: output_media sin sub-fields
  await probe('B: empty output_media', { ...base, output_media: {} });

  // Variante C: sin output_media (default Meet)
  await probe('C: no output_media', { ...base });
})();
