import { v4 as uuid } from 'uuid';
import { EventEmitter } from 'events';
import { logger } from '../../logger';
import type { Database } from '../../db';
import type {
  Interview,
  InterviewTurn,
  Evaluation,
  Report,
  Job,
  Candidate,
  TranscriptFragment,
} from '../../types';
import { getLeia } from '../leia';
import { getTTS } from '../tts';
import { getRecall } from '../recall';

/**
 * InterviewEngine: orquesta el ciclo de una entrevista v2.
 *
 * Eventos emitidos (Engine.events.on('event', e => ...)):
 *   - interview_status (status)
 *   - candidate_speaking (isSpeaking)
 *   - bot_speaking (isSpeaking, text)
 *   - caption_received (fragment)
 *   - leia_evaluation_ready (evaluation)
 *   - question_generated (question)
 *   - audio_generated (mimeType, durationMs)
 *   - report_ready (kind, report)
 *   - interview_finished (durationSec)
 *   - error (message)
 */
export class InterviewEngine {
  readonly events = new EventEmitter();

  private interviewId: string;
  private job!: Job;
  private candidate!: Candidate;
  private interview!: Interview;
  private botId: string | null = null;
  private startedAtMs = 0;
  private turnIndex = 0;
  private currentQuestion = '';
  private currentTurn: InterviewTurn | null = null;
  private answerBuffer: string[] = [];
  private answerStartedAtMs = 0;
  private finished = false;
  private candidateAnswerTimer: NodeJS.Timeout | null = null;
  private recall = getRecall();
  private leia = getLeia();
  private tts = getTTS();
  private boundRecallHandler: (evt: any) => void = () => {};

  constructor(private db: Database, interviewId: string) {
    this.interviewId = interviewId;
  }

  async start(): Promise<void> {
    const iv = await this.db.getInterview(this.interviewId);
    if (!iv) throw new Error('Entrevista no encontrada');
    this.interview = iv;

    const job = await this.db.getJob(iv.jobId);
    if (!job) throw new Error('Puesto no encontrado');
    this.job = job;

    const cand = await this.db.getCandidate(iv.candidateId);
    if (!cand) throw new Error('Candidato no encontrado');
    this.candidate = cand;

    this.startedAtMs = Date.now();
    await this.db.updateInterview(iv.id, {
      status: 'en_curso',
      startedAt: new Date(this.startedAtMs).toISOString(),
    });
    this.emit('interview_status', { status: 'en_curso' });

    // Suscribirse a eventos de Recall.ai filtrados por nuestra interviewId
    this.boundRecallHandler = (evt: any) => this.handleRecallEvent(evt);
    this.recall.events.on('event', this.boundRecallHandler);

    // Bot entra a Meet
    const joinRes = await this.recall.joinMeet({
      interviewId: iv.id,
      meetUrl: iv.meetUrl,
      language: this.job.requirements.language,
    });
    this.botId = joinRes.botId;
    await this.db.updateInterview(iv.id, { recallBotId: joinRes.botId });

    // Primera pregunta + muletillas en paralelo (las muletillas no bloquean).
    const introPromise = this.leia.firstQuestion({
      job: this.job,
      candidateName: this.candidate.name,
    });
    // Disparar la generación de muletillas sin esperar; cuando lleguen, emitimos al cliente.
    this.leia
      .generateFillers({ job: this.job, candidateName: this.candidate.name })
      .then((fillers) => {
        this.emit('fillers_ready', { fillers });
      })
      .catch(() => {
        // ignorar; el cliente tiene fallback chico
      });
    const intro = await introPromise;
    await this.askQuestion(intro);
  }

  /**
   * Llamada explícita desde el frontend o desde un test: simula que el candidato responde
   * "text" en este turno. En producción la respuesta llega vía captions de Recall.ai.
   */
  async simulateCandidateAnswer(text: string) {
    if (!this.recall.simulateCandidateAnswer) return;
    await this.recall.simulateCandidateAnswer(this.interviewId, text);
  }

  async stop(reason: 'manual' | 'auto' = 'manual'): Promise<{ report1?: Report; report2?: Report }> {
    if (this.finished) {
      const r1 = await this.db.getReport(this.interviewId, 1);
      const r2 = await this.db.getReport(this.interviewId, 2);
      return { report1: r1 ?? undefined, report2: r2 ?? undefined };
    }
    this.finished = true;
    if (this.candidateAnswerTimer) clearTimeout(this.candidateAnswerTimer);

    const endMs = Date.now();
    const durationSec = Math.round((endMs - this.startedAtMs) / 1000);

    if (this.botId) {
      await this.recall.leaveMeet({ interviewId: this.interviewId, botId: this.botId });
    }
    this.recall.events.off('event', this.boundRecallHandler);

    await this.db.updateInterview(this.interviewId, {
      status: 'completada',
      endedAt: new Date(endMs).toISOString(),
      durationSec,
    });
    this.emit('interview_status', { status: 'completada', reason });
    this.emit('interview_finished', { durationSec });

    const reports = await this.generateReports();
    return reports;
  }

  // ============================================================
  // Internals
  // ============================================================
  private async askQuestion(text: string, opts?: { isClarification?: boolean }) {
    if (this.finished) return;
    this.currentQuestion = text;
    this.emit('question_generated', {
      question: text,
      index: this.turnIndex,
      isClarification: !!opts?.isClarification,
    });

    // Crear el turno antes de la respuesta para luego mergear caption del candidato
    const turn: InterviewTurn = {
      id: uuid(),
      interviewId: this.interviewId,
      index: this.turnIndex,
      question: text,
      questionAt: new Date().toISOString(),
      answerTranscript: '',
      durationSec: 0,
    };
    this.currentTurn = await this.db.createTurn(turn);

    // TTS de la pregunta
    const audio = await this.tts.synthesize(text);
    this.emit('audio_generated', {
      text,
      mimeType: audio.mimeType,
      durationMs: audio.durationMs,
      bytes: audio.bytes,
    });

    // El bot reproduce el audio en la reunión.
    if (this.botId) {
      await this.recall.playAudio({
        interviewId: this.interviewId,
        botId: this.botId,
        audioBase64: audio.audioBase64,
        mimeType: audio.mimeType,
        text,
      });
    }
  }

  private async handleRecallEvent(evt: any) {
    if (!evt?.payload || evt.payload.interviewId !== this.interviewId) return;

    if (evt.type === 'lifecycle') {
      this.emit('lifecycle', evt.payload);
      return;
    }

    if (evt.type === 'speaking') {
      const { speaker, isSpeaking } = evt.payload;
      if (speaker === 'candidate') {
        this.emit('candidate_speaking', { isSpeaking });
        if (isSpeaking) {
          this.answerStartedAtMs = Date.now();
          if (this.candidateAnswerTimer) clearTimeout(this.candidateAnswerTimer);
        } else {
          // Cuando deja de hablar, espera ~600 ms para considerar la respuesta completa.
          if (this.candidateAnswerTimer) clearTimeout(this.candidateAnswerTimer);
          this.candidateAnswerTimer = setTimeout(() => {
            this.commitAnswer().catch((err) =>
              logger.error({ err }, 'Error procesando respuesta')
            );
          }, 600);
        }
      } else {
        this.emit('bot_speaking', { isSpeaking });
      }
      return;
    }

    if (evt.type === 'caption') {
      const frag: TranscriptFragment = {
        id: uuid(),
        interviewId: this.interviewId,
        speaker: evt.payload.speaker,
        text: evt.payload.text,
        startMs: evt.payload.startMs,
        endMs: evt.payload.endMs,
        isFinal: evt.payload.isFinal,
        receivedAt: new Date().toISOString(),
      };
      await this.db.appendTranscript(frag);
      this.emit('caption_received', frag);

      if (evt.payload.speaker === 'candidate' && evt.payload.isFinal) {
        this.answerBuffer.push(evt.payload.text);
      }
    }
  }

  private async commitAnswer() {
    if (this.finished || !this.currentTurn) return;

    const text = this.answerBuffer.join(' ').trim();
    this.answerBuffer = [];
    const durationSec =
      this.answerStartedAtMs > 0 ? Math.max(1, Math.round((Date.now() - this.answerStartedAtMs) / 1000)) : 1;

    const updatedTurn = await this.db.updateTurn(this.currentTurn.id, {
      answerTranscript: text,
      answerAt: new Date().toISOString(),
      durationSec,
    });
    if (!updatedTurn) return;

    const history = await this.db.listTurns(this.interviewId);
    const elapsedSec = Math.round((Date.now() - this.startedAtMs) / 1000);

    let result = await this.leia.evaluate({
      job: this.job,
      candidateName: this.candidate.name,
      history,
      lastQuestion: this.currentQuestion,
      lastAnswer: text,
      turnIndex: this.turnIndex,
      elapsedSec,
    });

    // Cinturón de seguridad: si la próxima pregunta es muy parecida a alguna ya
    // hecha (Jaccard > 0.6), forzamos a leIA a regenerar una distinta.
    if (!result.shouldFinish && history.length > 0) {
      const repeat = findSimilarQuestion(result.nextQuestion, history.map((h) => h.question));
      if (repeat) {
        logger.info({ existing: repeat, generated: result.nextQuestion }, 'leIA repitió pregunta, regenerando');
        const retried = await this.leia.evaluate({
          job: this.job,
          candidateName: this.candidate.name,
          history,
          lastQuestion: this.currentQuestion,
          lastAnswer:
            text +
            ` [Nota interna: la pregunta "${truncate(result.nextQuestion, 120)}" es muy parecida a "${truncate(repeat, 120)}" — generá una distinta, sobre otro ángulo del puesto.]`,
          turnIndex: this.turnIndex,
          elapsedSec,
        });
        // Si la segunda también es similar, dejamos pasar para no entrar en loop.
        result = retried;
      }
    }

    const evaluation: Evaluation = {
      id: uuid(),
      interviewId: this.interviewId,
      turnId: updatedTurn.id,
      score: result.evaluation.score,
      dimensions: result.evaluation.dimensions,
      flags: result.evaluation.flags,
      rationale: result.evaluation.rationale,
      createdAt: new Date().toISOString(),
    };
    await this.db.createEvaluation(evaluation);
    await this.db.updateTurn(updatedTurn.id, { evaluationId: evaluation.id });
    this.emit('leia_evaluation_ready', { evaluation, turnId: updatedTurn.id });

    if (result.shouldFinish) {
      const closing = await this.leia.generateClosing({
        job: this.job,
        candidateName: this.candidate.name,
      });
      this.emit('question_generated', { question: closing, index: this.turnIndex + 1, isClosing: true });
      const audio = await this.tts.synthesize(closing);
      this.emit('audio_generated', {
        text: closing,
        mimeType: audio.mimeType,
        durationMs: audio.durationMs,
        bytes: audio.bytes,
      });
      if (this.botId) {
        await this.recall.playAudio({
          interviewId: this.interviewId,
          botId: this.botId,
          audioBase64: audio.audioBase64,
          mimeType: audio.mimeType,
          text: closing,
        });
      }
      await this.stop('auto');
      return;
    }

    // Si leIA pide aclaración no avanzamos el índice de turno temático:
    // sigue siendo la misma "pregunta" original, solo que reformulada.
    if (!result.isClarification) this.turnIndex++;
    await this.askQuestion(result.nextQuestion, { isClarification: !!result.isClarification });
  }

  private async generateReports(): Promise<{ report1?: Report; report2?: Report }> {
    const turns = await this.db.listTurns(this.interviewId);
    const evaluations = await this.db.listEvaluations(this.interviewId);
    const transcripts = await this.db.listTranscripts(this.interviewId);
    const durationSec =
      this.interview.durationSec ?? Math.round((Date.now() - this.startedAtMs) / 1000);

    // Releemos la interview por si el endpoint /finalize persistió behavior recién.
    const fresh = await this.db.getInterview(this.interviewId);
    const behavior = fresh?.behavioralAnalysis ?? null;

    const fullTranscript = transcripts
      .filter((t) => t.speaker === 'bot' || t.speaker === 'candidate')
      .map((t) => ({
        speaker: t.speaker as 'bot' | 'candidate',
        text: t.text,
        atMs: t.startMs - (transcripts[0]?.startMs ?? 0),
      }));

    let report1: Report | undefined;
    if (this.job.preferences.generateReport1) {
      const payload1 = await this.leia.buildReport1({
        job: this.job,
        candidateName: this.candidate.name,
        fullTranscript,
        durationSec,
        language: this.job.requirements.language,
        behavior,
      });
      report1 = await this.db.createReport({
        id: uuid(),
        interviewId: this.interviewId,
        candidateId: this.candidate.id,
        jobId: this.job.id,
        kind: 1,
        payload: payload1,
        createdAt: new Date().toISOString(),
      });
      this.emit('report_ready', { kind: 1, report: report1 });
    }

    let report2: Report | undefined;
    if (this.job.preferences.generateReport2) {
      const evalForLeia = evaluations.map((e) => {
        const turn = turns.find((t) => t.id === e.turnId);
        return {
          question: turn?.question ?? '',
          transcript: turn?.answerTranscript ?? '',
          score: e.score,
          dims: e.dimensions,
          flags: e.flags,
        };
      });
      const payload2 = await this.leia.buildReport2({
        job: this.job,
        candidateName: this.candidate.name,
        evaluations: evalForLeia,
        behavior,
      });
      report2 = await this.db.createReport({
        id: uuid(),
        interviewId: this.interviewId,
        candidateId: this.candidate.id,
        jobId: this.job.id,
        kind: 2,
        payload: payload2,
        createdAt: new Date().toISOString(),
      });
      this.emit('report_ready', { kind: 2, report: report2 });
    }

    return { report1, report2 };
  }

  private emit(type: string, payload: unknown) {
    this.events.emit('event', { type, payload });
  }
}

// ============================================================
// Registry para mantener engines activos por interview
// ============================================================
const engines = new Map<string, InterviewEngine>();

export function getEngine(db: Database, interviewId: string): InterviewEngine {
  let e = engines.get(interviewId);
  if (!e) {
    e = new InterviewEngine(db, interviewId);
    engines.set(interviewId, e);
  }
  return e;
}

export function disposeEngine(interviewId: string) {
  engines.delete(interviewId);
}

// ============================================================
// Helpers para detectar preguntas repetidas
// ============================================================
const SIMILARITY_THRESHOLD = 0.6;
const STOPWORDS = new Set([
  'a', 'al', 'algo', 'algun', 'alguna', 'alguno', 'ante', 'aqui', 'asi', 'aun', 'b',
  'cada', 'como', 'con', 'cual', 'cuales', 'cuando', 'cuanto', 'da', 'de', 'del', 'desde', 'donde',
  'el', 'ella', 'ellos', 'en', 'entre', 'era', 'es', 'esa', 'ese', 'eso', 'esta', 'este', 'esto',
  'fue', 'ha', 'hay', 'la', 'las', 'le', 'lo', 'los', 'mas', 'me', 'mi', 'muy', 'ni', 'no', 'nos',
  'o', 'os', 'para', 'pero', 'por', 'porque', 'que', 'quien', 'se', 'si', 'sin', 'sobre', 'su', 'sus',
  'tan', 'te', 'tu', 'tus', 'un', 'una', 'unas', 'uno', 'unos', 'ya', 'yo',
  'contame', 'decime', 'podes', 'podrias', 'puedes', 'podria', 'podriamos', 'tenes',
]);

function findSimilarQuestion(candidate: string, previous: string[]): string | null {
  const candTokens = tokenSet(candidate);
  if (candTokens.size === 0) return null;
  for (const prev of previous) {
    const prevTokens = tokenSet(prev);
    if (prevTokens.size === 0) continue;
    const inter = new Set([...candTokens].filter((t) => prevTokens.has(t)));
    const union = new Set([...candTokens, ...prevTokens]);
    const j = inter.size / union.size;
    if (j >= SIMILARITY_THRESHOLD) return prev;
  }
  return null;
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9áéíóúüñ\s]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
