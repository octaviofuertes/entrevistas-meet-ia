import { config } from '../../config';
import { logger } from '../../logger';
import { MockRecall } from './mock';
import { RealRecall } from './real';
import { EventEmitter } from 'events';

export interface CaptionEvent {
  interviewId: string;
  botId: string;
  speaker: 'bot' | 'candidate' | 'other';
  text: string;
  startMs: number;
  endMs: number;
  isFinal: boolean;
}

export interface SpeakingEvent {
  interviewId: string;
  botId: string;
  speaker: 'bot' | 'candidate';
  isSpeaking: boolean;
}

export interface BotLifecycleEvent {
  interviewId: string;
  botId: string;
  status: 'joining' | 'joined' | 'left' | 'error';
  message?: string;
}

export type RecallEvent =
  | { type: 'caption'; payload: CaptionEvent }
  | { type: 'speaking'; payload: SpeakingEvent }
  | { type: 'lifecycle'; payload: BotLifecycleEvent };

export interface JoinMeetInput {
  interviewId: string;
  meetUrl: string;
  language: string;
}

export interface JoinMeetResult {
  botId: string;
  meetUrl: string;
  status: 'joining' | 'joined' | 'error';
}

export interface PlayAudioInput {
  interviewId: string;
  botId: string;
  audioBase64: string;
  mimeType: string;
  text: string;
}

export interface RecallService {
  /** Event bus para escuchar captions, lifecycle y speaking. */
  readonly events: EventEmitter;

  joinMeet(input: JoinMeetInput): Promise<JoinMeetResult>;
  leaveMeet(input: { interviewId: string; botId: string }): Promise<void>;
  playAudio(input: PlayAudioInput): Promise<{ playbackId: string; durationMs: number }>;

  /** Simulación: el candidato dice algo (solo modo mock). */
  simulateCandidateAnswer?(interviewId: string, text: string): Promise<void>;
}

let instance: RecallService | null = null;

export function getRecall(): RecallService {
  if (instance) return instance;

  if (config.RECALL_DRIVER === 'recall') {
    if (!config.RECALL_API_KEY) {
      logger.warn('RECALL_DRIVER=recall pero RECALL_API_KEY vacío. Usando mock como fallback.');
      instance = new MockRecall();
    } else {
      logger.info({ region: config.RECALL_REGION }, 'Recall.ai inicializado');
      instance = new RealRecall();
    }
  } else {
    logger.info('Recall.ai en modo mock');
    instance = new MockRecall();
  }
  return instance;
}
