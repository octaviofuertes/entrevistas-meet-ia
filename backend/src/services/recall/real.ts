import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import { config } from '../../config';
import { logger } from '../../logger';
import type {
  RecallService,
  JoinMeetInput,
  JoinMeetResult,
  PlayAudioInput,
} from './index';

/**
 * Driver real de Recall.ai.
 *
 * Crea un bot que se une al Google Meet, transcripción mediante los
 * captions nativos de Meet (transcription_provider: meeting_captions).
 *
 * Los eventos (captions, lifecycle, speaking) llegan vía webhook al backend
 * y se reenvían a este EventEmitter desde el endpoint POST /webhooks/recall.
 *
 * Docs: https://docs.recall.ai/
 */
export class RealRecall implements RecallService {
  readonly events = new EventEmitter();
  private endpoint = `https://${config.RECALL_REGION}.recall.ai/api/v1`;
  private botToInterview = new Map<string, string>();

  async joinMeet(input: JoinMeetInput): Promise<JoinMeetResult> {
    try {
      const res = await fetch(`${this.endpoint}/bot/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token ${config.RECALL_API_KEY}`,
        },
        body: JSON.stringify({
          bot_name: config.RECALL_BOT_NAME,
          meeting_url: input.meetUrl,
          recording_config: {
            transcript: {
              provider: {
                recallai_streaming: {
                  mode: input.language?.startsWith('en') ? 'prioritize_low_latency' : 'prioritize_accuracy',
                  language_code: input.language?.startsWith('en') ? 'en' : 'auto',
                },
              },
              diarization: {
                use_separate_streams_when_available: true,
              },
            },
            realtime_endpoints: [
              {
                type: 'webhook',
                url: `${publicBaseUrl()}/webhooks/recall/captions`,
                events: [
                  'transcript.data',
                  'transcript.partial_data',
                  'participant_events.speech_on',
                  'participant_events.speech_off',
                ],
                metadata: { interviewId: input.interviewId },
              },
            ],
          },
          automatic_audio_output: {
            in_call_recording: {
              data: {
                kind: 'mp3',
                b64_data: SILENT_MP3_BASE64,
              },
            },
          },
          metadata: { interviewId: input.interviewId },
        }),
      });
      if (!res.ok) throw new Error(`Recall.ai ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { id: string };
      this.botToInterview.set(data.id, input.interviewId);
      this.events.emit('event', {
        type: 'lifecycle',
        payload: { interviewId: input.interviewId, botId: data.id, status: 'joining' },
      });
      return { botId: data.id, meetUrl: input.meetUrl, status: 'joining' };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'error desconocido';
      logger.error({ err }, 'Recall.ai: error al crear bot');
      this.events.emit('event', {
        type: 'lifecycle',
        payload: {
          interviewId: input.interviewId,
          botId: 'unknown',
          status: 'error',
          message,
        },
      });
      throw new Error(`No se pudo crear el bot de Recall.ai: ${message}`);
    }
  }

  async leaveMeet({ interviewId, botId }: { interviewId: string; botId: string }) {
    try {
      await fetch(`${this.endpoint}/bot/${botId}/leave_call/`, {
        method: 'POST',
        headers: { Authorization: `Token ${config.RECALL_API_KEY}` },
      });
    } catch (err) {
      logger.warn({ err, botId }, 'Recall.ai: error al desconectar bot (continuamos igual)');
    }
    this.botToInterview.delete(botId);
    this.events.emit('event', {
      type: 'lifecycle',
      payload: { interviewId, botId, status: 'left' },
    });
  }

  async playAudio(input: PlayAudioInput): Promise<{ playbackId: string; durationMs: number }> {
    const playbackId = `pb_${uuid()}`;
    try {
      if (input.mimeType !== 'audio/mpeg') {
        throw new Error(`Recall.ai output_audio requiere audio/mpeg; recibido ${input.mimeType}`);
      }
      const res = await fetch(`${this.endpoint}/bot/${input.botId}/output_audio/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token ${config.RECALL_API_KEY}`,
        },
        body: JSON.stringify({
          kind: 'mp3',
          b64_data: input.audioBase64,
        }),
      });
      if (!res.ok) throw new Error(`output_audio ${res.status}: ${await res.text()}`);
    } catch (err) {
      logger.error({ err }, 'Recall.ai: error reproduciendo audio');
      throw err;
    }
    const words = input.text.split(/\s+/).filter(Boolean).length;
    return { playbackId, durationMs: Math.max(1500, words * 320) };
  }

  /** Recibe un evento de webhook ya parseado y lo emite a los listeners. */
  ingestWebhook(payload: any) {
    const botId = payload.bot_id ?? payload.botId ?? payload.data?.bot?.id;
    const interviewId =
      this.botToInterview.get(botId) ??
      payload.metadata?.interviewId ??
      payload.data?.bot?.metadata?.interviewId ??
      payload.data?.recording?.metadata?.interviewId ??
      payload.data?.realtime_endpoint?.metadata?.interviewId;
    if (!interviewId) return;

    if (payload.event === 'transcript.data' || payload.event === 'transcript.partial_data' || payload.event === 'captions') {
      const transcriptData = payload.data?.data ?? payload.data ?? {};
      const words = transcriptData.words ?? [];
      const text = words.map((w: any) => w.text).join(' ').trim();
      if (!text) return;
      const isFinal = payload.event !== 'transcript.partial_data' && (transcriptData.is_final ?? true);
      const participant = transcriptData.participant ?? payload.participant ?? {};
      const participantName = String(participant.name ?? '');
      const speaker = participantName === config.RECALL_BOT_NAME ? 'bot' : 'candidate';
      const firstWord = words[0];
      const lastWord = words[words.length - 1];
      const startMs = toMs(firstWord?.start_timestamp?.relative ?? payload.data?.start_timestamp_ms);
      const endMs = toMs(lastWord?.end_timestamp?.relative ?? payload.data?.end_timestamp_ms ?? startMs);
      this.events.emit('event', {
        type: 'caption',
        payload: {
          interviewId,
          botId,
          speaker,
          text,
          startMs,
          endMs,
          isFinal,
        },
      });
    } else if (payload.event === 'participant_events.speech_on' || payload.event === 'participant_events.speech_off') {
      const participant = payload.data?.data?.participant ?? payload.participant ?? {};
      const participantName = String(participant.name ?? '');
      const speaker = participantName === config.RECALL_BOT_NAME ? 'bot' : 'candidate';
      this.events.emit('event', {
        type: 'speaking',
        payload: {
          interviewId,
          botId,
          speaker,
          isSpeaking: payload.event === 'participant_events.speech_on',
        },
      });
    } else if (payload.event === 'bot.in_call_recording' || payload.event === 'bot.joined') {
      this.events.emit('event', {
        type: 'lifecycle',
        payload: { interviewId, botId, status: 'joined' },
      });
    } else if (payload.event === 'bot.call_ended' || payload.event === 'bot.left') {
      this.events.emit('event', {
        type: 'lifecycle',
        payload: { interviewId, botId, status: 'left' },
      });
      this.botToInterview.delete(botId);
    }
  }
}

const SILENT_MP3_BASE64 =
  'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQwAAAAAAAAAAAAAAAAAAAAAAA';

function toMs(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return Date.now();
  return value > 10_000 ? Math.round(value) : Math.round(value * 1000);
}

function publicBaseUrl(): string {
  return process.env.PUBLIC_BASE_URL ?? `http://localhost:${config.PORT}`;
}
