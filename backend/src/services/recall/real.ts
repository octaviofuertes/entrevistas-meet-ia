import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import { config } from '../../config';
import { logger } from '../../logger';
import { botStageBus } from '../../realtime/bot-stage';
import type {
  RecallService,
  JoinMeetInput,
  JoinMeetResult,
  PlayAudioInput,
} from './index';

/**
 * Driver real de Recall.ai.
 *
 * Notas críticas (de la doc oficial):
 *
 * 1. Para que el endpoint POST /bot/{id}/output_audio/ funcione, el bot
 *    se debe crear con `automatic_audio_output` con un MP3 base64 válido.
 *    Acá usamos como "fallback inicial" el MP3 de la primera pregunta de
 *    leIA (si el caller lo pasa). Así el bot saluda apenas entra al Meet,
 *    sin un round-trip extra a /output_audio.
 *
 * 2. Usamos `recallai_streaming` como provider de transcripción — transcribe
 *    el audio directamente sin necesitar que se activen los subtítulos de Meet.
 *
 * 3. El webhook en tiempo real va en `realtime_endpoints` dentro de
 *    `recording_config`. PUBLIC_BASE_URL TIENE que ser una URL pública
 *    (ngrok / dominio) — si está en localhost, Recall no llega.
 *
 * Docs: https://docs.recall.ai
 */
export class RealRecall implements RecallService {
  readonly events = new EventEmitter();
  private endpoint = `https://${config.RECALL_REGION}.recall.ai/api/v1`;
  private botToInterview = new Map<string, string>();

  async joinMeet(input: JoinMeetInput): Promise<JoinMeetResult> {
    const base = publicBaseUrl();
    const webhookUrl = `${base}/webhooks/recall/captions`;
    const stageUrl = `${base}/bot-stage/${input.interviewId}`;

    const body = {
      bot_name: config.RECALL_BOT_NAME,
      meeting_url: input.meetUrl,
      // Output Media → webpage: única forma confiable de que el bot reproduzca
      // audio interactivo (Recall documenta /output_audio como NO permitido
      // para "dynamic transcription-based replies"). La página la armamos lo
      // más parecida posible al avatar default de Meet (gris + círculo + L).
      output_media: {
        camera: {
          kind: 'webpage',
          config: { url: stageUrl },
        },
      },
      recording_config: {
        transcript: {
          provider: { recallai_streaming: {} },
        },
        realtime_endpoints: [
          {
            type: 'webhook',
            url: webhookUrl,
            events: [
              'transcript.data',
              'transcript.partial_data',
              'participant_events.speech_on',
              'participant_events.speech_off',
            ],
          },
        ],
      },
      metadata: { interviewId: input.interviewId },
    };

    try {
      const res = await fetch(`${this.endpoint}/bot/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token ${config.RECALL_API_KEY}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Recall.ai ${res.status}: ${errBody.slice(0, 500)}`);
      }
      const data = (await res.json()) as { id: string };
      this.botToInterview.set(data.id, input.interviewId);
      logger.info(
        { botId: data.id, meetUrl: input.meetUrl, webhookUrl, stageUrl },
        'Recall.ai bot creado (output_media → bot-stage)'
      );
      this.events.emit('event', {
        type: 'lifecycle',
        payload: { interviewId: input.interviewId, botId: data.id, status: 'joining' },
      });
      return { botId: data.id, meetUrl: input.meetUrl, status: 'joining' };
    } catch (err) {
      logger.error({ err }, 'Recall.ai: error al crear bot');
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
    if (!botId || botId.startsWith('bot_err_')) {
      this.botToInterview.delete(botId);
      return;
    }
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
    const words = input.text.split(/\s+/).filter(Boolean).length;
    const estimatedDurationMs = Math.max(1500, words * 320);

    // Audio → bot-stage por WS. El bot lo reproduce con <audio> nativo y Recall
    // lo streamea al Meet como su voz.
    botStageBus.send(input.interviewId, {
      type: 'play',
      mimeType: input.mimeType,
      audioBase64: input.audioBase64,
    });
    logger.info(
      { interviewId: input.interviewId, bytes: input.audioBase64.length, connected: botStageBus.isConnected(input.interviewId) },
      'bot-stage: audio enviado'
    );
    return { playbackId, durationMs: estimatedDurationMs };
  }

  /**
   * Recibe un evento de webhook ya parseado y lo emite a los listeners.
   * Soporta los formatos que Recall.ai usa hoy.
   */
  ingestWebhook(payload: any) {
    if (!payload) return;
    const evt = payload.event ?? payload.type;
    const data = payload.data ?? {};
    const botId =
      data.bot?.id ??
      data.bot_id ??
      payload.bot_id ??
      payload.bot?.id ??
      payload.botId;
    const interviewId =
      this.botToInterview.get(botId) ??
      data.bot?.metadata?.interviewId ??
      data.metadata?.interviewId ??
      payload.metadata?.interviewId;

    logger.info({ event: evt, botId, interviewId }, 'recall webhook');

    if (!interviewId) {
      // Puede llegar un evento de un bot que no es nuestro; ignorar.
      return;
    }

    // -------- Captions / transcript --------
    if (evt === 'transcript.data' || evt === 'transcript.partial_data' || evt === 'captions') {
      const inner = data.data ?? data;
      const words = inner.words ?? inner.transcript?.words ?? [];
      const text = words.map((w: any) => w.text ?? w.word ?? '').join(' ').trim();
      if (!text) return;

      const isFinal = evt !== 'transcript.partial_data';
      const speaker = classifySpeaker(inner.participant);
      const firstWord = words[0];
      const lastWord = words[words.length - 1];

      this.events.emit('event', {
        type: 'caption',
        payload: {
          interviewId,
          botId,
          speaker,
          text,
          startMs: toMs(firstWord?.start_timestamp?.relative) ?? Date.now(),
          endMs: toMs(lastWord?.end_timestamp?.relative) ?? Date.now(),
          isFinal,
        },
      });
      return;
    }

    // -------- Speech on/off --------
    if (evt === 'participant_events.speech_on' || evt === 'participant_events.speech_off') {
      const inner = data.data ?? data;
      const speaker = classifySpeaker(inner.participant);
      this.events.emit('event', {
        type: 'speaking',
        payload: {
          interviewId,
          botId,
          speaker,
          isSpeaking: evt === 'participant_events.speech_on',
        },
      });
      return;
    }

    // -------- Lifecycle --------
    if (evt === 'bot.in_call_recording' || evt === 'bot.joined') {
      this.events.emit('event', {
        type: 'lifecycle',
        payload: { interviewId, botId, status: 'joined' },
      });
      return;
    }
    if (evt === 'bot.joining_call') {
      this.events.emit('event', {
        type: 'lifecycle',
        payload: { interviewId, botId, status: 'joining' },
      });
      return;
    }
    if (evt === 'bot.call_ended' || evt === 'bot.done' || evt === 'bot.left') {
      this.events.emit('event', {
        type: 'lifecycle',
        payload: { interviewId, botId, status: 'left' },
      });
      this.botToInterview.delete(botId);
      return;
    }
    if (evt === 'bot.fatal') {
      this.events.emit('event', {
        type: 'lifecycle',
        payload: {
          interviewId,
          botId,
          status: 'error',
          message: data.sub_code ?? data.message ?? 'fatal',
        },
      });
      return;
    }
  }
}

/**
 * Clasifica si el participante es el bot (leIA) o el candidato.
 *
 * En Google Meet el bot aparece como un participante con el `bot_name` que
 * configuramos. Tomamos eso como criterio principal; si no, fallback a is_host.
 */
function classifySpeaker(participant: any): 'bot' | 'candidate' {
  if (!participant) return 'candidate';
  const normalize = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const name = normalize(String(participant.name ?? ''));
  const botName = normalize(config.RECALL_BOT_NAME);
  if (name && botName && (name === botName || name.includes('leia') || name.includes('entrevistadora'))) {
    return 'bot';
  }
  return 'candidate';
}

function toMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  return value > 10_000 ? Math.round(value) : Math.round(value * 1000);
}

function publicBaseUrl(): string {
  const u = process.env.PUBLIC_BASE_URL ?? '';
  if (!u || u.startsWith('http://localhost') || u.startsWith('http://127.')) {
    throw new Error(
      'PUBLIC_BASE_URL no está configurado a una URL pública (necesario para webhooks de Recall.ai). ' +
        'Ejemplo: PUBLIC_BASE_URL=https://abc123.ngrok-free.app'
    );
  }
  return u.replace(/\/+$/, '');
}

/**
 * MP3 silencioso (~50 ms) en base64. Es válido y muy chico — sirve como fallback
 * para `automatic_audio_output` cuando el caller no provee la primera pregunta.
 * Generado con: ffmpeg -f lavfi -i anullsrc -t 0.05 -ac 1 -ar 24000 -b:a 32k out.mp3
 */
const SILENT_MP3_BASE64 =
  'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQwAAAAAAAAAAAAAAAAAAAAAAA';
