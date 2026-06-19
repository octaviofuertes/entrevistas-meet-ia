/**
 * Script helper: levanta ngrok apuntando al puerto del backend,
 * muestra la URL pública y la setea como PUBLIC_BASE_URL para
 * que Recall.ai pueda enviar webhooks al backend local.
 *
 * Uso:  npx tsx scripts/start-ngrok.ts
 */
import ngrok from 'ngrok';

const PORT = parseInt(process.env.PORT || '4000', 10);

async function main() {
  console.log(`\n🔌 Conectando ngrok al puerto ${PORT}...\n`);

  const url = await ngrok.connect({
    addr: PORT,
    proto: 'http',
  });

  console.log('✅ ngrok activo!\n');
  console.log('┌──────────────────────────────────────────────────────┐');
  console.log(`│  URL pública: ${url.padEnd(38)} │`);
  console.log('└──────────────────────────────────────────────────────┘');
  console.log('\n📋 Copiá esta línea en tu .env y reiniciá el backend:\n');
  console.log(`   PUBLIC_BASE_URL=${url}`);
  console.log(`   CORS_ORIGIN=http://localhost:3000,${url}`);
  console.log('\n⏳ ngrok queda corriendo. Ctrl+C para cerrar.\n');

  // Mantener el proceso vivo
  process.on('SIGINT', async () => {
    console.log('\n🛑 Cerrando ngrok...');
    await ngrok.disconnect();
    await ngrok.kill();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Error al iniciar ngrok:', err);
  process.exit(1);
});
