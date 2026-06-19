import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import { logger } from '../../logger';
import type {
  RecallService,
  JoinMeetInput,
  JoinMeetResult,
  PlayAudioInput,
} from './index';

/**
 * Mock de Recall.ai. No habla con servicios externos; simula:
 *   - el ciclo de vida del bot (joining -> joined -> left)
 *   - la reproducción de audio (devuelve duración estimada)
 *   - los captions del candidato (a través de simulateCandidateAnswer)
 */
export class MockRecall implements RecallService {
  readonly events = new EventEmitter();
  private bots = new Map<string, { interviewId: string; meetUrl: string }>();

  async joinMeet(input: JoinMeetInput): Promise<JoinMeetResult> {
    const botId = `bot_${uuid()}`;
    this.bots.set(botId, { interviewId: input.interviewId, meetUrl: input.meetUrl });
    this.events.emit('event', {
      type: 'lifecycle',
      payload: { interviewId: input.interviewId, botId, status: 'joining' },
    });
    // En 250ms "se conecta" para simular un join real.
    setTimeout(() => {
      this.events.emit('event', {
        type: 'lifecycle',
        payload: { interviewId: input.interviewId, botId, status: 'joined' },
      });
    }, 250);
    return { botId, meetUrl: input.meetUrl, status: 'joining' };
  }

  async leaveMeet({ interviewId, botId }: { interviewId: string; botId: string }) {
    this.bots.delete(botId);
    this.events.emit('event', {
      type: 'lifecycle',
      payload: { interviewId, botId, status: 'left' },
    });
  }

  async playAudio(input: PlayAudioInput): Promise<{ playbackId: string; durationMs: number }> {
    const playbackId = `pb_${uuid()}`;
    const words = input.text.split(/\s+/).filter(Boolean).length;
    const durationMs = Math.max(1200, words * 320); // ~187 palabras por minuto

    // Mientras el bot "habla" emitimos caption del bot
    this.events.emit('event', {
      type: 'speaking',
      payload: {
        interviewId: input.interviewId,
        botId: input.botId,
        speaker: 'bot',
        isSpeaking: true,
      },
    });
    this.events.emit('event', {
      type: 'caption',
      payload: {
        interviewId: input.interviewId,
        botId: input.botId,
        speaker: 'bot',
        text: input.text,
        startMs: Date.now(),
        endMs: Date.now() + durationMs,
        isFinal: true,
      },
    });
    setTimeout(() => {
      this.events.emit('event', {
        type: 'speaking',
        payload: {
          interviewId: input.interviewId,
          botId: input.botId,
          speaker: 'bot',
          isSpeaking: false,
        },
      });
    }, Math.min(durationMs, 50));

    return { playbackId, durationMs };
  }

  async simulateCandidateAnswer(interviewId: string, text: string) {
    const bot = Array.from(this.bots.entries()).find(([, v]) => v.interviewId === interviewId);
    if (!bot) {
      logger.warn({ interviewId }, 'simulateCandidateAnswer: bot no encontrado');
      return;
    }
    const [botId] = bot;
    const words = text.split(/\s+/).filter(Boolean).length;
    const durationMs = Math.max(800, words * 280);

    this.events.emit('event', {
      type: 'speaking',
      payload: { interviewId, botId, speaker: 'candidate', isSpeaking: true },
    });
    // Emite el caption final inmediatamente para no introducir delays en la demo
    this.events.emit('event', {
      type: 'caption',
      payload: {
        interviewId,
        botId,
        speaker: 'candidate',
        text,
        startMs: Date.now(),
        endMs: Date.now() + durationMs,
        isFinal: true,
      },
    });
    this.events.emit('event', {
      type: 'speaking',
      payload: { interviewId, botId, speaker: 'candidate', isSpeaking: false },
    });
  }
}
