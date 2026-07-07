import { GoogleGenAI, Modality } from '@google/genai';
import { config } from '../../config';
import { logger } from '../../logger';
import { pcmToWav } from '../tts/gemini';
import type { Job, Candidate } from '../../types';

const MODEL = 'gemini-2.5-flash-native-audio-latest';
const OUTPUT_SAMPLE_RATE = 24000;

export interface VoiceSessionEvents {
  onAudio: (wavBase64: string, durationMs: number) => void;
  onOutputTranscript: (text: string) => void;
  onInputTranscript: (text: string) => void;
  onTurnComplete: () => void;
  onInterrupted: () => void;
  onError: (err: Error) => void;
  onClose: (code?: number, reason?: string) => void;
}

/**
 * Envuelve la conexión Live de Gemini para que leIA converse con voz nativa.
 * Ticket 02: conexión + saludo + latencia. Ticket 03: conversación completa
 * (turnComplete, transcripción de entrada, barge-in vía sendCandidateAudio).
 */
export class VoiceSession {
  private session: any;
  private events: VoiceSessionEvents;

  constructor(events: VoiceSessionEvents) {
    this.events = events;
  }

  async connectAndGreet(job: Job, candidate: Candidate, cvText?: string | null): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
    const systemInstruction = buildLiveSystemPrompt(job, candidate, cvText);
    const sentAt = Date.now();
    let firstAudioAt = 0;

    this.session = await ai.live.connect({
      model: MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction,
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        thinkingConfig: { thinkingBudget: 0 },
      },
      callbacks: {
        onopen: () => logger.info('voice-session: conectado a Gemini Live'),
        onmessage: (msg: any) => {
          const sc = msg.serverContent;
          if (sc?.interrupted) {
            this.events.onInterrupted();
          }
          if (sc?.modelTurn?.parts) {
            for (const p of sc.modelTurn.parts) {
              if (p.inlineData?.data) {
                if (!firstAudioAt) {
                  firstAudioAt = Date.now();
                  logger.info({ latencyMs: firstAudioAt - sentAt }, 'voice-session: latencia primer audio');
                }
                const pcm = Buffer.from(p.inlineData.data, 'base64');
                const wav = pcmToWav(pcm, OUTPUT_SAMPLE_RATE);
                const durationMs = Math.round((pcm.length / 2 / OUTPUT_SAMPLE_RATE) * 1000);
                this.events.onAudio(wav.toString('base64'), Math.max(800, durationMs));
              }
            }
          }
          if (sc?.outputTranscription?.text) {
            this.events.onOutputTranscript(sc.outputTranscription.text);
          }
          if (sc?.inputTranscription?.text) {
            this.events.onInputTranscript(sc.inputTranscription.text);
          }
          if (sc?.turnComplete) {
            this.events.onTurnComplete();
          }
        },
        onerror: (e: any) => this.events.onError(new Error(e?.message ?? String(e))),
        onclose: (e: any) => this.events.onClose(e?.code, e?.reason),
      },
    });

    this.session.sendClientContent({
      turns: `Arrancá la entrevista: saludá brevemente a ${candidate.name} presentándote como leIA, y después hacé la primera pregunta.`,
      turnComplete: true,
    });
  }

  /** Audio del candidato, pausado a tiempo real por quien llama (nunca en ráfaga). */
  sendCandidateAudio(pcmChunk: Buffer) {
    this.session?.sendRealtimeInput({
      audio: { data: pcmChunk.toString('base64'), mimeType: 'audio/pcm;rate=16000' },
    });
  }

  /** Instrucción de texto (ej. pedir el cierre de la entrevista). */
  sendTextInstruction(text: string) {
    this.session?.sendClientContent({ turns: text, turnComplete: true });
  }

  close() {
    try {
      this.session?.close();
    } catch {
      /* noop */
    }
  }
}

export function buildLiveSystemPrompt(job: Job, candidate: Candidate, cvText?: string | null): string {
  const dimensiones = job.preferences.dimensionsToCover?.join(', ') || 'experiencia general y ajuste al puesto';
  const cvSection = cvText
    ? ` CV del candidato (texto extraído, puede tener errores de formato): ${cvText.slice(0, 3000)}`
    : '';
  return `Sos leIA, entrevistadora virtual con personalidad propia. Hablás español rioplatense con voseo natural, tono ${job.preferences.toneOfVoice}. Vas a entrevistar a ${candidate.name} para el puesto de ${job.title} en ${job.company}. La entrevista dura unos ${job.preferences.durationMinutes} minutos y debe cubrir estas dimensiones: ${dimensiones}. Reglas: hacé una sola pregunta por vez, escuchá la respuesta completa del candidato antes de continuar, no repitas preguntas ya hechas, y cuando te lo indique una instrucción de sistema, cerrá la entrevista agradeciendo brevemente.${cvSection}`;
}

// ============================================================
// Registro global de instancias por interview (para que el WS de la sala
// pueda rutear el audio del candidato hacia la sesión Live correspondiente)
// ============================================================
const voiceSessions = new Map<string, VoiceSession>();

export function registerVoiceSession(interviewId: string, session: VoiceSession) {
  voiceSessions.set(interviewId, session);
}

export function getVoiceSession(interviewId: string): VoiceSession | undefined {
  return voiceSessions.get(interviewId);
}

export function disposeVoiceSession(interviewId: string) {
  voiceSessions.delete(interviewId);
}
