/**
 * Spike T06 (Etapa 0) — Gemini Live API como driver primario de voz de la
 * sala nativa. Sonda manual (no forma parte de la suite de tests).
 *
 * Verifica, con evidencia, los 8 criterios del Plan Ejecutor:
 *   1. Conexión y conversación básica
 *   2. Transcripciones de entrada/salida
 *   3. Barge-in (interrupción)
 *   4. Sesión larga (resumption + compresión de contexto) — mecanismo
 *   5. Voces en español
 *   6. Latencia (fin-de-habla → primer audio)
 *   7. Steering (inyección de instrucción a mitad de sesión)
 *   8. Costo (usageMetadata)
 *
 * Requiere GEMINI_API_KEY de tier pago en el .env. Usa ffmpeg (debe estar en
 * PATH) para convertir el audio sintetizado con Edge TTS a PCM 16kHz que el
 * Live API espera como entrada.
 *
 * Correr con: npx tsx backend/scripts/spike-live-api.ts
 */
import 'dotenv/config';
import { GoogleGenAI, Modality } from '@google/genai';
import { spawn } from 'node:child_process';
import { webcrypto } from 'node:crypto';

if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

function runFfmpegPipe(input: Buffer, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    const chunks: Buffer[] = [];
    proc.stdout.on('data', (d: Buffer) => chunks.push(d));
    proc.stderr.on('data', () => {});
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg salió con código ${code}`));
    });
    proc.stdin.write(input);
    proc.stdin.end();
  });
}
const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = 'gemini-2.5-flash-native-audio-latest';

if (!API_KEY) {
  console.error('Falta GEMINI_API_KEY en el entorno.');
  process.exit(1);
}

const SYSTEM_INSTRUCTION = `Sos leIA, entrevistadora virtual con personalidad propia. Hablás español rioplatense con voseo natural, tono cálido y curioso. Sos concisa: tus respuestas hablan como en una charla real, 1-3 oraciones.`;

type Result = Record<string, unknown>;
const results: Result = {};

async function synthesizeInputAudioPCM16k(text: string): Promise<Buffer> {
  const mod: any = await import('msedge-tts');
  const Ctor = mod.MsEdgeTTS ?? mod.default?.MsEdgeTTS ?? mod.default;
  const client = new Ctor();
  const OUTPUT = mod.OUTPUT_FORMAT ?? mod.default?.OUTPUT_FORMAT;
  await client.setMetadata('es-AR-ElenaNeural', OUTPUT?.AUDIO_24KHZ_48KBITRATE_MONO_MP3 ?? 'audio-24khz-48kbitrate-mono-mp3');
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const stream = client.toStream(text);
    const audioStream = stream.audioStream ?? stream;
    audioStream.on('data', (d: Buffer) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    audioStream.on('end', () => resolve());
    audioStream.on('error', reject);
  });
  const mp3 = Buffer.concat(chunks);

  // ffmpeg: mp3 -> PCM 16-bit LE, 16kHz, mono, raw (sin header) via stdin/stdout.
  return runFfmpegPipe(mp3, [
    '-hide_banner', '-loglevel', 'error',
    '-i', 'pipe:0',
    '-f', 's16le', '-ar', '16000', '-ac', '1',
    'pipe:1',
  ]);
}

async function connectSession(ai: GoogleGenAI, opts: { voiceName?: string; onEvent: (e: any) => void }) {
  const session = await ai.live.connect({
    model: MODEL,
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: SYSTEM_INSTRUCTION,
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      sessionResumption: {},
      // NOTA (spike): 'proactivity' no está soportado por la API directa de
      // Gemini con este modelo — el server rechaza toda la sesión
      // (code 1007 "Unknown name proactivity at 'setup'"). Ver informe.
      speechConfig: opts.voiceName
        ? { voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voiceName } }, languageCode: 'es-US' }
        : undefined,
    },
    callbacks: {
      onopen: () => opts.onEvent({ kind: 'open' }),
      onmessage: (msg: any) => opts.onEvent({ kind: 'message', msg }),
      onerror: (e: any) => opts.onEvent({ kind: 'error', error: e?.message ?? String(e) }),
      onclose: (e: any) => opts.onEvent({ kind: 'close', code: e?.code, reason: e?.reason }),
    },
  });
  return session;
}

async function main() {
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  // ============================================================
  // Test A — Conexión + primer turno + latencia + transcripción de salida
  // ============================================================
  console.log('\n=== Test A: conexión, primer turno, latencia, transcripción de salida ===');
  {
    const events: any[] = [];
    let firstAudioAt = 0;
    const sentAt = Date.now();
    let audioBytes = 0;
    let outputTranscript = '';
    let sawSessionHandle: string | undefined;
    let usage: any = null;

    const session = await connectSession(ai, {
      onEvent: (e) => {
        events.push(e);
        if (e.kind === 'message') {
          const sc = e.msg.serverContent;
          if (sc?.modelTurn?.parts) {
            for (const p of sc.modelTurn.parts) {
              if (p.inlineData?.data && firstAudioAt === 0) firstAudioAt = Date.now();
              if (p.inlineData?.data) audioBytes += Buffer.from(p.inlineData.data, 'base64').length;
            }
          }
          if (sc?.outputTranscription?.text) outputTranscript += sc.outputTranscription.text;
          if (e.msg.sessionResumptionUpdate?.newHandle) sawSessionHandle = e.msg.sessionResumptionUpdate.newHandle;
          if (e.msg.usageMetadata) usage = e.msg.usageMetadata;
        }
      },
    });

    session.sendClientContent({
      turns: 'Hola, soy Ana, la candidata. Contame en una frase quién sos y para qué puesto es esta entrevista de prueba.',
      turnComplete: true,
    });

    await new Promise((r) => setTimeout(r, 6000));
    session.close();

    const latencyMs = firstAudioAt ? firstAudioAt - sentAt : null;
    results.testA_conexion_y_primer_turno = {
      conectó: events.some((e) => e.kind === 'open'),
      recibióAudio: audioBytes > 0,
      audioBytesTotales: audioBytes,
      latenciaPrimerAudioMs: latencyMs,
      transcripciónSalida: outputTranscript || '(vacía — ver nota)',
      handleDeResumptionRecibido: !!sawSessionHandle,
      usageMetadata: usage,
      erroresCrudos: events.filter((e) => e.kind === 'error'),
      eventosDeCierre: events.filter((e) => e.kind === 'close'),
    };
    console.log(JSON.stringify(results.testA_conexion_y_primer_turno, null, 2));
  }

  // ============================================================
  // Test B — Barge-in: interrumpir mientras el modelo está generando
  // ============================================================
  console.log('\n=== Test B: barge-in (audio real por sendRealtimeInput mientras el modelo habla) ===');
  {
    // El SDK documenta que `sendClientContent` NO está optimizado para
    // interrupciones (agrega al contexto "en orden"); el mecanismo real de
    // barge-in es enviar AUDIO por `sendRealtimeInput` mientras el modelo
    // está generando — como haría el micrófono del candidato en la sala.
    const interruptPcm = await synthesizeInputAudioPCM16k('Perdón, te interrumpo, ¿me repetís eso?');

    const events: any[] = [];
    let sawInterrupted = false;
    let interruptSentAt = 0;
    let interruptedDetectedAt = 0;
    let audioChunksAfterInterrupt = 0;
    let interruptedFlag = false;
    let firstAudioAt = 0;
    let sessionRef: any = null;

    const session = await connectSession(ai, {
      onEvent: (e) => {
        events.push(e);
        if (e.kind === 'message') {
          const sc = e.msg.serverContent;
          if (sc?.modelTurn?.parts?.some((p: any) => p.inlineData) && firstAudioAt === 0) {
            firstAudioAt = Date.now();
            interruptSentAt = Date.now();
            interruptedFlag = true;
            const CHUNK = 4096;
            for (let i = 0; i < interruptPcm.length; i += CHUNK) {
              sessionRef.sendRealtimeInput({
                audio: { data: interruptPcm.subarray(i, i + CHUNK).toString('base64'), mimeType: 'audio/pcm;rate=16000' },
              });
            }
          }
          if (sc?.interrupted) {
            sawInterrupted = true;
            if (!interruptedDetectedAt) interruptedDetectedAt = Date.now();
          }
          if (interruptedFlag && sc?.modelTurn?.parts?.some((p: any) => p.inlineData)) {
            audioChunksAfterInterrupt++;
          }
        }
      },
    });
    sessionRef = session;

    // Pedimos una respuesta larga para tener margen de interrumpirla a mitad de camino.
    session.sendClientContent({
      turns:
        'Contame con mucho detalle, en al menos ocho oraciones largas, cómo es tu proceso completo para evaluar a un candidato técnico de principio a fin.',
      turnComplete: true,
    });

    await new Promise((r) => setTimeout(r, 8000));
    session.close();

    results.testB_bargeIn = {
      detectóInterrupcion: sawInterrupted,
      latenciaHastaDeteccionMs: sawInterrupted ? interruptedDetectedAt - interruptSentAt : null,
      chunksDeAudioTrasInterrupcion: audioChunksAfterInterrupt,
      metodo: 'audio real vía sendRealtimeInput (no sendClientContent)',
      nota: 'chunksDeAudioTrasInterrupcion cuenta mensajes con audio DESPUÉS de la interrupción enviada; si es 0 el modelo cortó limpio.',
    };
    console.log(JSON.stringify(results.testB_bargeIn, null, 2));
  }

  // ============================================================
  // Test C — Audio real de entrada + transcripción de entrada
  // ============================================================
  console.log('\n=== Test C: audio real de entrada (Edge TTS -> PCM16k) + transcripción ===');
  {
    const spokenText = 'Tengo experiencia con React, Node y bases de datos PostgreSQL desde hace tres años.';
    let pcm: Buffer | null = null;
    let ffmpegError: string | null = null;
    try {
      pcm = await synthesizeInputAudioPCM16k(spokenText);
    } catch (err: any) {
      ffmpegError = err?.message ?? String(err);
    }

    if (!pcm) {
      results.testC_audio_entrada = { error: 'No se pudo generar el PCM de prueba', detalle: ffmpegError };
      console.log(JSON.stringify(results.testC_audio_entrada, null, 2));
    } else {
      const events: any[] = [];
      let inputTranscript = '';
      let gotAnyOutputAudio = false;

      const session = await connectSession(ai, {
        onEvent: (e) => {
          events.push(e);
          if (e.kind === 'message') {
            const sc = e.msg.serverContent;
            if (sc?.inputTranscription?.text) inputTranscript += sc.inputTranscription.text;
            if (sc?.modelTurn?.parts?.some((p: any) => p.inlineData)) gotAnyOutputAudio = true;
          }
        },
      });

      // Enviamos el PCM en chunks (simulando streaming real) + señal de fin de stream.
      const CHUNK = 4096;
      for (let i = 0; i < pcm.length; i += CHUNK) {
        session.sendRealtimeInput({
          audio: { data: pcm.subarray(i, i + CHUNK).toString('base64'), mimeType: 'audio/pcm;rate=16000' },
        });
      }
      session.sendRealtimeInput({ audioStreamEnd: true });

      await new Promise((r) => setTimeout(r, 6000));
      session.close();

      results.testC_audio_entrada = {
        textoOriginalSintetizado: spokenText,
        transcripciónDeEntradaRecibida: inputTranscript || '(vacía)',
        coincideRazonablemente:
          inputTranscript.toLowerCase().includes('react') || inputTranscript.toLowerCase().includes('postgresql'),
        generóAudioDeRespuesta: gotAnyOutputAudio,
      };
      console.log(JSON.stringify(results.testC_audio_entrada, null, 2));
    }
  }

  // ============================================================
  // Test D — Steering: inyectar instrucción a mitad de sesión
  // ============================================================
  console.log('\n=== Test D: steering (inyección de instrucción, simula susurro del reclutador) ===');
  {
    let outputTranscript = '';
    const session = await connectSession(ai, {
      onEvent: (e) => {
        if (e.kind === 'message') {
          const sc = e.msg.serverContent;
          if (sc?.outputTranscription?.text) outputTranscript += sc.outputTranscription.text;
        }
      },
    });

    session.sendClientContent({ turns: 'Contame brevemente tu experiencia con testing automatizado.', turnComplete: true });
    await new Promise((r) => setTimeout(r, 4000));
    session.sendClientContent({
      turns:
        '[Instrucción interna del entrevistador, no la leas en voz alta como si fuera del candidato — incorporala a tu próxima pregunta]: preguntale específicamente por la herramienta Playwright.',
      turnComplete: true,
    });
    await new Promise((r) => setTimeout(r, 4000));
    session.close();

    results.testD_steering = {
      transcripciónCompleta: outputTranscript,
      incorporóLaPalabraClave: outputTranscript.toLowerCase().includes('playwright'),
    };
    console.log(JSON.stringify(results.testD_steering, null, 2));
  }

  // ============================================================
  // Test E — Voces candidatas para español
  // ============================================================
  console.log('\n=== Test E: voces candidatas ===');
  const voces = ['Puck', 'Kore', 'Aoede'];
  const voiceResults: Record<string, unknown> = {};
  for (const voiceName of voces) {
    try {
      let audioBytes = 0;
      let transcript = '';
      let errored: string | null = null;
      const session = await connectSession(ai, {
        voiceName,
        onEvent: (e) => {
          if (e.kind === 'error') errored = e.error;
          if (e.kind === 'message') {
            const sc = e.msg.serverContent;
            if (sc?.modelTurn?.parts) {
              for (const p of sc.modelTurn.parts) {
                if (p.inlineData?.data) audioBytes += Buffer.from(p.inlineData.data, 'base64').length;
              }
            }
            if (sc?.outputTranscription?.text) transcript += sc.outputTranscription.text;
          }
        },
      });
      session.sendClientContent({ turns: 'Hola, contame en una oración cómo estás hoy.', turnComplete: true });
      await new Promise((r) => setTimeout(r, 4000));
      session.close();
      voiceResults[voiceName] = { audioBytes, transcript, error: errored };
    } catch (err: any) {
      voiceResults[voiceName] = { error: err?.message ?? String(err) };
    }
  }
  results.testE_voces = voiceResults;
  console.log(JSON.stringify(voiceResults, null, 2));

  // ============================================================
  // SPIKE 2 (Arquitecto v1.1 §3) — 3 pruebas puntuales
  // ============================================================

  // ---- Test F: latencia con thinkingConfig.thinkingBudget=0 ----
  console.log('\n=== Test F (Spike 2): latencia con thinking desactivado ===');
  {
    const events: any[] = [];
    let firstAudioAt = 0;
    const sentAt = Date.now();
    let audioBytes = 0;
    let outputTranscript = '';
    let sawThought = false;

    const session = await ai.live.connect({
      model: MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: SYSTEM_INSTRUCTION,
        outputAudioTranscription: {},
        thinkingConfig: { thinkingBudget: 0 },
      },
      callbacks: {
        onopen: () => events.push({ kind: 'open' }),
        onmessage: (msg: any) => {
          events.push({ kind: 'message' });
          const sc = msg.serverContent;
          if (sc?.modelTurn?.parts) {
            for (const p of sc.modelTurn.parts) {
              if (p.thought) sawThought = true;
              if (p.inlineData?.data && firstAudioAt === 0) firstAudioAt = Date.now();
              if (p.inlineData?.data) audioBytes += Buffer.from(p.inlineData.data, 'base64').length;
            }
          }
          if (sc?.outputTranscription?.text) outputTranscript += sc.outputTranscription.text;
        },
        onerror: (e: any) => events.push({ kind: 'error', error: e?.message ?? String(e) }),
        onclose: (e: any) => events.push({ kind: 'close', code: e?.code, reason: e?.reason }),
      },
    });

    session.sendClientContent({
      turns: 'Hola, soy Ana, la candidata. Contame en una frase quién sos y para qué puesto es esta entrevista de prueba.',
      turnComplete: true,
    });
    await new Promise((r) => setTimeout(r, 6000));
    session.close();

    results.testF_latenciaSinThinking = {
      conectó: events.some((e) => e.kind === 'open'),
      rechazadoPorConfigInvalida: events.some((e) => e.kind === 'close' && e.code !== 1000),
      eventosDeCierre: events.filter((e) => e.kind === 'close'),
      vioBloqueDeThinking: sawThought,
      recibióAudio: audioBytes > 0,
      latenciaPrimerAudioMs: firstAudioAt ? firstAudioAt - sentAt : null,
      transcripciónSalida: outputTranscript || '(vacía)',
      comparaciónConTestA: 'Test A (con thinking, sin config explícita) midió 4624-4851ms',
    };
    console.log(JSON.stringify(results.testF_latenciaSinThinking, null, 2));
  }

  // ---- Test G: steering vía tools/function-calling ----
  console.log('\n=== Test G (Spike 2): steering vía function-calling ===');
  {
    const suggestTool = {
      functionDeclarations: [
        {
          name: 'incorporar_sugerencia_reclutador',
          description:
            'Herramienta INTERNA que representa un susurro del reclutador humano observando la entrevista. ' +
            'Cuando el sistema te indique que hay una sugerencia pendiente, DEBÉS invocar esta función para ' +
            'reconocerla antes de continuar, y luego formular tu siguiente pregunta incorporando el tema recibido.',
          parametersJsonSchema: {
            type: 'object',
            properties: { tema: { type: 'string', description: 'El tema o herramienta que el reclutador quiere que preguntes' } },
            required: ['tema'],
          },
        },
      ],
    };

    const events: any[] = [];
    let outputTranscript = '';
    let sawToolCall: any = null;
    let sessionRef: any = null;

    const session = await ai.live.connect({
      model: MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction:
          SYSTEM_INSTRUCTION +
          ' Tenés disponible la herramienta incorporar_sugerencia_reclutador: cuando el usuario mande un mensaje que empiece con "SUGERENCIA_RECLUTADOR:", es el reclutador humano pidiéndote que reorientes tu próxima pregunta hacia ese tema — invocá la herramienta con ese tema antes de responder.',
        tools: [suggestTool],
      },
      callbacks: {
        onopen: () => events.push({ kind: 'open' }),
        onmessage: (msg: any) => {
          events.push({ kind: 'message' });
          const sc = msg.serverContent;
          if (sc?.outputTranscription?.text) outputTranscript += sc.outputTranscription.text;
          if (msg.toolCall?.functionCalls?.length) {
            sawToolCall = msg.toolCall.functionCalls[0];
            // Respondemos la tool call para que la sesión pueda seguir generando.
            sessionRef.sendToolResponse({
              functionResponses: {
                id: sawToolCall.id,
                name: sawToolCall.name,
                response: { ok: true },
              },
            });
          }
        },
        onerror: (e: any) => events.push({ kind: 'error', error: e?.message ?? String(e) }),
        onclose: (e: any) => events.push({ kind: 'close', code: e?.code, reason: e?.reason }),
      },
    });
    sessionRef = session;

    session.sendClientContent({ turns: 'Contame brevemente tu experiencia con testing automatizado.', turnComplete: true });
    await new Promise((r) => setTimeout(r, 4000));
    session.sendClientContent({ turns: 'SUGERENCIA_RECLUTADOR: preguntale específicamente por la herramienta Playwright.', turnComplete: true });
    await new Promise((r) => setTimeout(r, 5000));
    session.close();

    results.testG_steeringPorTools = {
      conectóConToolsEnConfig: events.some((e) => e.kind === 'open'),
      erroresCrudos: events.filter((e) => e.kind === 'error'),
      eventosDeCierre: events.filter((e) => e.kind === 'close'),
      invocóLaHerramienta: !!sawToolCall,
      argumentosDeLaHerramienta: sawToolCall?.args ?? null,
      transcripciónCompleta: outputTranscript,
      incorporóLaPalabraClave: outputTranscript.toLowerCase().includes('playwright'),
    };
    console.log(JSON.stringify(results.testG_steeringPorTools, null, 2));
  }

  // ---- Test H: barge-in + transcripción de entrada con audio PACEADO a tiempo real ----
  console.log('\n=== Test H (Spike 2): barge-in y transcripción de entrada con audio paceado ===');
  {
    async function sendPacedAudio(session: any, pcm: Buffer, chunkBytes = 3200) {
      // 16kHz, 16-bit, mono => 32000 bytes/seg. chunkBytes=3200 => ~100ms de audio por chunk.
      const bytesPerMs = 32; // 32000 bytes/seg / 1000 ms
      const chunkMs = chunkBytes / bytesPerMs;
      for (let i = 0; i < pcm.length; i += chunkBytes) {
        session.sendRealtimeInput({
          audio: { data: pcm.subarray(i, i + chunkBytes).toString('base64'), mimeType: 'audio/pcm;rate=16000' },
        });
        await new Promise((r) => setTimeout(r, chunkMs));
      }
      session.sendRealtimeInput({ audioStreamEnd: true });
    }

    // H1: transcripción de entrada, ahora paceada.
    {
      const spokenText = 'Tengo experiencia con React, Node y bases de datos PostgreSQL desde hace tres años.';
      const pcm = await synthesizeInputAudioPCM16k(spokenText);
      let inputTranscript = '';
      const session = await connectSession(ai, {
        onEvent: (e) => {
          if (e.kind === 'message') {
            const sc = e.msg.serverContent;
            if (sc?.inputTranscription?.text) inputTranscript += sc.inputTranscription.text;
          }
        },
      });
      await sendPacedAudio(session, pcm);
      await new Promise((r) => setTimeout(r, 4000));
      session.close();
      results.testH1_transcripcionEntradaPaceada = {
        textoOriginalSintetizado: spokenText,
        transcripciónRecibida: inputTranscript || '(vacía)',
        coincideRazonablemente:
          inputTranscript.toLowerCase().includes('react') && inputTranscript.toLowerCase().includes('postgresql'),
      };
      console.log(JSON.stringify(results.testH1_transcripcionEntradaPaceada, null, 2));
    }

    // H2: barge-in, interrumpiendo con audio paceado mientras el modelo habla.
    {
      const interruptPcm = await synthesizeInputAudioPCM16k('Perdón, te interrumpo, ¿me repetís eso?');
      let sawInterrupted = false;
      let interruptSentAt = 0;
      let interruptedDetectedAt = 0;
      let firstAudioAt = 0;
      let sessionRef: any = null;
      let interruptSent = false;

      const session = await connectSession(ai, {
        onEvent: (e) => {
          if (e.kind === 'message') {
            const sc = e.msg.serverContent;
            if (sc?.modelTurn?.parts?.some((p: any) => p.inlineData) && firstAudioAt === 0) {
              firstAudioAt = Date.now();
              interruptSentAt = Date.now();
              interruptSent = true;
              sendPacedAudio(sessionRef, interruptPcm).catch(() => {});
            }
            if (sc?.interrupted && interruptSent && !interruptedDetectedAt) {
              sawInterrupted = true;
              interruptedDetectedAt = Date.now();
            }
          }
        },
      });
      sessionRef = session;

      session.sendClientContent({
        turns:
          'Contame con mucho detalle, en al menos ocho oraciones largas, cómo es tu proceso completo para evaluar a un candidato técnico de principio a fin.',
        turnComplete: true,
      });
      await new Promise((r) => setTimeout(r, 12000));
      session.close();

      results.testH2_bargeInPaceado = {
        detectóInterrupcion: sawInterrupted,
        latenciaHastaDeteccionMs: sawInterrupted ? interruptedDetectedAt - interruptSentAt : null,
      };
      console.log(JSON.stringify(results.testH2_bargeInPaceado, null, 2));
    }
  }

  console.log('\n=== RESULTADOS COMPLETOS (JSON) ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error('Spike falló:', err);
  process.exit(1);
});
