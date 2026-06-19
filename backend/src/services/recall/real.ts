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
          transcription_options: {
            provider: 'meeting_captions',
          },
          real_time_transcription: {
            destination_url: `${publicBaseUrl()}/webhooks/recall/captions`,
            partial_results: false,
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
      logger.error({ err }, 'Recall.ai: error al crear bot');
      // Fallback: devolver "error" sin romper la entrevista
      const botId = `bot_err_${uuid()}`;
      this.events.emit('event', {
        type: 'lifecycle',
        payload: {
          interviewId: input.interviewId,
          botId,
          status: 'error',
          message: (err as Error).message,
        },
      });
      return { botId, meetUrl: input.meetUrl, status: 'error' };
    }
  }

  async leaveMeet({ interviewId, botId }: { interviewId: string; botId: string }) {
    try {
      await fetch(`${this.endpoint}/bot/${botId}/leave_call`, {
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
      const res = await fetch(`${this.endpoint}/bot/${input.botId}/output_audio`, {
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
    }
    const words = input.text.split(/\s+/).filter(Boolean).length;
    return { playbackId, durationMs: Math.max(1500, words * 320) };
  }

  /** Recibe un evento de webhook ya parseado y lo emite a los listeners. */
  ingestWebhook(payload: any) {
    const botId = payload.bot_id ?? payload.botId;
    const interviewId = this.botToInterview.get(botId) ?? payload.metadata?.interviewId;
    if (!interviewId) return;

    if (payload.event === 'transcript.data' || payload.event === 'captions') {
      const words = payload.data?.words ?? [];
      const text = words.map((w: any) => w.text).join(' ').trim();
      const isFinal = payload.data?.is_final ?? true;
      const speaker = (payload.participant?.is_host ? 'bot' : 'candidate') as 'bot' | 'candidate';
      this.events.emit('event', {
        type: 'caption',
        payload: {
          interviewId,
          botId,
          speaker,
          text,
          startMs: payload.data?.start_timestamp_ms ?? Date.now(),
          endMs: payload.data?.end_timestamp_ms ?? Date.now(),
          isFinal,
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

function publicBaseUrl(): string {
  return process.env.PUBLIC_BASE_URL ?? `http://localhost:${config.PORT}`;
}
