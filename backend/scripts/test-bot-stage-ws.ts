import WebSocket from 'ws';

const url = 'wss://classical-crop-consisting-mistress.trycloudflare.com/ws/bot-stage/diag-test';

console.log(`[test-bot-stage-ws] connecting to ${url}`);

const ws = new WebSocket(url, {
  handshakeTimeout: 8000,
});

const start = Date.now();
const elapsed = () => `${Date.now() - start}ms`;

ws.on('open', () => {
  console.log(`[test-bot-stage-ws] OPEN at ${elapsed()}`);
});

ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
  const size = Buffer.isBuffer(data) ? data.length : (data as any).byteLength ?? 'unknown';
  console.log(`[test-bot-stage-ws] MESSAGE at ${elapsed()} binary=${isBinary} size=${size}`);
});

ws.on('close', (code: number, reason: Buffer) => {
  console.log(`[test-bot-stage-ws] CLOSE at ${elapsed()} code=${code} reason="${reason.toString()}"`);
});

ws.on('error', (err: Error) => {
  console.log(`[test-bot-stage-ws] ERROR at ${elapsed()}: ${err.message}`);
});

ws.on('unexpected-response', (_req, res) => {
  console.log(`[test-bot-stage-ws] UNEXPECTED-RESPONSE at ${elapsed()} status=${res.statusCode} headers=${JSON.stringify(res.headers)}`);
});

setTimeout(() => {
  console.log(`[test-bot-stage-ws] closing after wait, readyState=${ws.readyState}`);
  try {
    ws.close(1000, 'diag-done');
  } catch (e) {
    console.log(`[test-bot-stage-ws] close threw: ${(e as Error).message}`);
  }
  // give close a moment
  setTimeout(() => {
    console.log(`[test-bot-stage-ws] exiting`);
    process.exit(0);
  }, 500);
}, 3000);
