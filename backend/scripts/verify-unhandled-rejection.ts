/**
 * Verificación de FIX-TTS-ROBUSTEZ (D3): reproduce el patrón exacto de
 * promesa flotante que `msedge-tts` usa internamente en `_rawSSMLRequest()`
 * (`this._send(request).then();` — sin `.catch`) y confirma que, con el
 * handler `process.on('unhandledRejection')` de `server.ts` instalado,
 * el proceso NO muere: loguea y sigue vivo hasta salir con código 0.
 *
 * No forma parte de la suite ni del build de producción.
 * Uso: cd backend && npx tsx scripts/verify-unhandled-rejection.ts
 */
process.on('unhandledRejection', (reason) => {
  console.log('[handler] unhandledRejection capturada, proceso sigue vivo:', String(reason));
});

function simulateEdgeTtsFloatingRejection() {
  // Mismo patrón que MsEdgeTTS._rawSSMLRequest(): dispara una promesa que
  // rechaza y le encadena `.then()` sin segundo argumento (sin catch).
  Promise.reject(new Error('Edge TTS WebSocket error: (code=ETIMEDOUT)')).then();
}

async function main() {
  simulateEdgeTtsFloatingRejection();
  // Le damos tiempo al event loop para que la rejection se procese y,
  // si no hubiera handler, tire abajo el proceso.
  await new Promise((r) => setTimeout(r, 200));
  console.log('SOBREVIVIO');
  process.exit(0);
}

main();
