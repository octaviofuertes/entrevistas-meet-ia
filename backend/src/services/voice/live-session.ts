import { GoogleGenAI, Modality } from '@google/genai';
import { config } from '../../config';
import { logger } from '../../logger';
import { pcmToWav } from '../tts/gemini';
import type { Job, Candidate } from '../../types';

const MODEL = 'gemini-2.5-flash-native-audio-latest';
const OUTPUT_SAMPLE_RATE = 24000;
const MAX_RECONNECT_ATTEMPTS = 2;
const RECONNECT_DELAY_MS = 500;

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
  private ai: GoogleGenAI | null = null;
  private job!: Job;
  private candidate!: Candidate;
  private cvText?: string | null;

  private resumptionHandle: string | undefined;
  private intentionalClose = false;
  private reconnecting = false;
  private reconnectAttempts = 0;

  constructor(events: VoiceSessionEvents) {
    this.events = events;
  }

  async connectAndGreet(job: Job, candidate: Candidate, cvText?: string | null): Promise<void> {
    this.job = job;
    this.candidate = candidate;
    this.cvText = cvText;
    this.ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

    await this.openSession();

    this.session.sendClientContent({
      turns: `Arrancá la entrevista: saludá brevemente a ${candidate.name} presentándote como leIA, y después hacé la primera pregunta.`,
      turnComplete: true,
    });
  }

  /**
   * Abre (o reabre, con `handle`) la conexión Live. `sessionResumption` +
   * `contextWindowCompression` sostienen sesiones más largas que los límites
   * documentados del proveedor (~10 min de conexión, ~15 min de audio sin
   * compresión); `goAway`/cierre inesperado disparan `reconnect()` con el
   * último handle recibido.
   */
  private async openSession(handle?: string): Promise<void> {
    const systemInstruction = buildLiveSystemPrompt(this.job, this.candidate, this.cvText);
    const sentAt = Date.now();
    let firstAudioAt = 0;

    this.session = await this.ai!.live.connect({
      model: MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction,
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        thinkingConfig: { thinkingBudget: 0 },
        sessionResumption: handle ? { handle } : {},
        contextWindowCompression: { slidingWindow: {} },
      },
      callbacks: {
        onopen: () => logger.info('voice-session: conectado a Gemini Live'),
        onmessage: (msg: any) => {
          if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate?.newHandle) {
            this.resumptionHandle = msg.sessionResumptionUpdate.newHandle;
            logger.debug(
              { handlePrefix: this.resumptionHandle!.slice(0, 12) },
              'voice-session: nuevo handle de resumption'
            );
          }
          if (msg.goAway) {
            logger.info(
              { timeLeft: msg.goAway.timeLeft },
              'voice-session: goAway recibido, reconectando proactivamente'
            );
            this.reconnect().catch((err) => {
              logger.warn({ err }, 'voice-session: reconexión tras goAway falló');
            });
          }

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
        onclose: (e: any) => {
          if (this.intentionalClose || this.reconnecting) return;
          if (shouldReconnect(this.intentionalClose, this.reconnecting, this.resumptionHandle, this.reconnectAttempts)) {
            this.reconnect()
              .then((ok) => {
                if (!ok) this.events.onClose(e?.code, e?.reason);
              })
              .catch((err) => {
                logger.warn({ err }, 'voice-session: reconexión tras cierre inesperado falló');
                this.events.onClose(e?.code, e?.reason);
              });
          } else {
            this.events.onClose(e?.code, e?.reason);
          }
        },
      },
    });
  }

  /** Reconecta con el último handle de resumption. No re-saluda: el estado se restaura del lado del servidor. */
  private async reconnect(): Promise<boolean> {
    if (!this.resumptionHandle) return false;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.warn('voice-session: se agotaron los reintentos de reconexión');
      return false;
    }
    this.reconnecting = true;
    this.reconnectAttempts++;
    try {
      try {
        this.session?.close();
      } catch {
        /* noop */
      }
      await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
      await this.openSession(this.resumptionHandle);
      this.reconnectAttempts = 0;
      logger.info('voice-session: reconectado con handle de resumption');
      return true;
    } finally {
      this.reconnecting = false;
    }
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
    this.intentionalClose = true;
    try {
      this.session?.close();
    } catch {
      /* noop */
    }
  }
}

/** Decide si conviene reconectar ante un cierre: no si fue intencional, ya está reconectando, no hay handle, o se agotaron los intentos. */
export function shouldReconnect(
  intentionalClose: boolean,
  reconnecting: boolean,
  handle: string | undefined,
  attempts: number,
  maxAttempts = MAX_RECONNECT_ATTEMPTS
): boolean {
  if (intentionalClose || reconnecting) return false;
  if (!handle) return false;
  return attempts < maxAttempts;
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
