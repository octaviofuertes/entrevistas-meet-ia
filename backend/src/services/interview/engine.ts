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
import { getTTS, type TTSService, type TTSResult } from '../tts';
import { getRecall, getBrowserRecall } from '../recall';
import type { RecallService } from '../recall';
import { computeQualityDistribution, computeSentimentFallback, isEmptySentiment } from './analytics';

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
  private silenceTimer: NodeJS.Timeout | null = null;
  private autoFinishTimer: NodeJS.Timeout | null = null;
  private committing = false;
  /** Hasta cuándo consideramos que leIA está hablando (para ignorar su eco). */
  private botSpeakingUntilMs = 0;
  private recall: RecallService = getRecall();
  private leia = getLeia();
  private tts: TTSService = getTTS();
  private boundRecallHandler: (evt: any) => void = () => {};
  private started = false;
  private fillerAudios: Array<{ audioBase64: string; mimeType: string; durationMs: number }> = [];
  private fillerPlaying = false;

  constructor(private db: Database, interviewId: string) {
    this.interviewId = interviewId;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const iv = await this.db.getInterview(this.interviewId);
    if (!iv) throw new Error('Entrevista no encontrada');
    this.interview = iv;
    this.tts = getTTS(iv.ttsDriver ?? undefined);
    // Recall driver: browser (sala nativa) o meet (Recall.ai / mock)
    this.recall = iv.mode === 'browser' ? getBrowserRecall(this.interviewId) : getRecall();

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

    // 1) Arrancar generación de fillers y de la primera pregunta en paralelo.
    const introPromise = this.leia.firstQuestion({
      job: this.job,
      candidateName: this.candidate.name,
    });
    this.leia
      .generateFillers({ job: this.job, candidateName: this.candidate.name })
      .then(async (fillers) => {
        this.emit('fillers_ready', { fillers });
        const safe = fillers.filter((f) => isNeutralFiller(f)).slice(0, 12);
        const results = await Promise.allSettled(
          safe.map((f) => this.tts.synthesize(f))
        );
        this.fillerAudios = results
          .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
          .map((r) => ({ audioBase64: r.value.audioBase64, mimeType: r.value.mimeType, durationMs: r.value.durationMs }));
        logger.info({ requested: safe.length, ready: this.fillerAudios.length }, 'muletillas pre-sintetizadas');
      })
      .catch(() => {});

    const isBrowser = iv.mode === 'browser';

    if (isBrowser) {
      // MODO BROWSER: joinMeet es instantáneo → llamarlo antes de TTS para que
      // botId esté listo. Luego sentence-streaming: el primer chunk de audio
      // llega al candidato apenas TTS sintetiza la primera oración (~200-400ms
      // más rápido que esperar TTS del texto completo).
      try {
        const joinRes = await this.recall.joinMeet({
          interviewId: iv.id,
          meetUrl: iv.meetUrl,
          language: this.job.requirements.language,
        });
        if (joinRes.status === 'error') throw new Error('BrowserRecall error');
        this.botId = joinRes.botId;
        await this.db.updateInterview(iv.id, { recallBotId: joinRes.botId });
      } catch (err) {
        this.recall.events.off('event', this.boundRecallHandler);
        await this.db.updateInterview(iv.id, { status: 'agendada', startedAt: null, recallBotId: null });
        this.emit('interview_status', { status: 'agendada' });
        throw err;
      }
      const intro = await introPromise;
      await this.askQuestion(intro); // sentence streaming — no preTtsAudio
    } else {
      // MODO MEET: pre-sintetizar el saludo antes de joinMeet para enviarlo
      // como automatic_audio_output en el mismo request (evita round-trip extra).
      const intro = await introPromise;
      let introAudio: Awaited<ReturnType<typeof this.tts.synthesize>> | null = null;
      try {
        introAudio = await this.tts.synthesize(intro);
      } catch (err) {
        logger.warn({ err }, 'TTS de la primera pregunta falló; el bot va a entrar mudo');
      }
      try {
        const joinRes = await this.recall.joinMeet({
          interviewId: iv.id,
          meetUrl: iv.meetUrl,
          language: this.job.requirements.language,
        });
        if (joinRes.status === 'error') throw new Error('Recall.ai no pudo crear el bot');
        this.botId = joinRes.botId;
        await this.db.updateInterview(iv.id, { recallBotId: joinRes.botId });
      } catch (err) {
        this.recall.events.off('event', this.boundRecallHandler);
        await this.db.updateInterview(iv.id, { status: 'agendada', startedAt: null, recallBotId: null });
        this.emit('interview_status', { status: 'agendada' });
        throw err;
      }
      await this.askQuestion(intro, { preTtsAudio: introAudio ?? undefined });
    }
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
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.autoFinishTimer) clearTimeout(this.autoFinishTimer);

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
  private async askQuestion(
    text: string,
    opts?: {
      isClarification?: boolean;
      /** Si true, NO se llama a recall.playAudio (porque ya lo dijo automatic_audio_output). */
      skipBotPlayback?: boolean;
      /** Audio ya sintetizado a reutilizar (evita un TTS extra). */
      preTtsAudio?: { audioBase64: string; mimeType: string; durationMs: number; bytes: number };
    }
  ) {
    if (this.finished) return;
    this.currentQuestion = text;
    this.emit('question_generated', {
      question: text,
      index: this.turnIndex,
      isClarification: !!opts?.isClarification,
    });

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

    // Arrancamos un turno limpio: descartamos cualquier resto de captions/ruido
    // del turno anterior que pudiera haber quedado bufferizado.
    this.resetAnswerState();

    // Si ya tenemos audio pre-sintetizado (saludo inicial) lo usamos directo.
    if (opts?.preTtsAudio) {
      const audio = opts.preTtsAudio;
      this.emit('audio_generated', { text, mimeType: audio.mimeType, durationMs: audio.durationMs, bytes: audio.bytes });
      if (this.botId && !opts.skipBotPlayback) {
        await this.recall.playAudio({ interviewId: this.interviewId, botId: this.botId, audioBase64: audio.audioBase64, mimeType: audio.mimeType, text });
        this.markBotSpeaking(audio.durationMs);
      }
      return;
    }

    if (opts?.skipBotPlayback || !this.botId) return;

    // Sentence streaming: TTS oración por oración, la primera empieza a sonar
    // ~1s después de que leIA genera el texto en vez de esperar TTS del texto completo.
    // playAudio() con output_audio es fire-and-forget → mientras Recall reproduce
    // la oración N, ya estamos sintetizando la N+1 (pipeline natural).
    const sentences = splitSentences(text);
    let totalDuration = 0;
    let firstSentAt = 0; // cuándo se envió el primer chunk de audio
    for (let i = 0; i < sentences.length; i++) {
      if (this.finished) break;
      let audio: TTSResult | null = null;
      try {
        audio = await this.tts.synthesize(sentences[i]);
      } catch (err) {
        logger.warn({ err, chunk: i }, 'TTS chunk falló, saltando oración');
        continue;
      }
      if (!audio || this.finished) break;
      totalDuration += audio.durationMs;
      await this.recall.playAudio({
        interviewId: this.interviewId,
        botId: this.botId,
        audioBase64: audio.audioBase64,
        mimeType: audio.mimeType,
        text: sentences[i],
      });
      // Marcar cuándo el primer chunk fue enviado (el audio empieza a sonar desde aquí)
      if (firstSentAt === 0) firstSentAt = Date.now();
    }
    if (totalDuration > 0) {
      // Calcular la ventana de silencio desde el primer envío, no desde el último.
      // Sin esto hay una "ventana muerta" de varios segundos post-audio donde los
      // transcripts del candidato se ignoran por isBotSpeaking().
      this.markBotSpeaking(totalDuration, firstSentAt || undefined);
      this.emit('audio_generated', { text, mimeType: 'audio/mpeg', durationMs: totalDuration, bytes: 0 });
    }
  }

  // ============================================================
  // End-of-turn / half-duplex helpers
  // ============================================================

  /** leIA va a estar "hablando" desde `from` (o ahora) durante durationMs. */
  private markBotSpeaking(durationMs: number, from?: number) {
    const base = from ?? Date.now();
    this.botSpeakingUntilMs = base + Math.max(800, durationMs) + BOT_ECHO_TAIL_MS;
  }

  private isBotSpeaking(): boolean {
    return Date.now() < this.botSpeakingUntilMs;
  }

  /** Limpia el buffer de respuesta y el timer de silencio. */
  private resetAnswerState() {
    this.answerBuffer = [];
    this.answerStartedAtMs = 0;
    this.committing = false;
    if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null; }
  }

  /**
   * Finaliza la entrevista automáticamente (genera el informe) cuando el Meet
   * termina o el candidato se va. Espera un toque por si fue una desconexión
   * momentánea, y es idempotente (stop ya se protege con this.finished).
   */
  private autoFinish(reason: string) {
    if (this.finished || this.autoFinishTimer) return;
    logger.info({ interviewId: this.interviewId, reason }, 'auto-finalizando entrevista');
    this.autoFinishTimer = setTimeout(() => {
      this.stop('auto').catch((err) => logger.error({ err }, 'auto-finish: stop falló'));
    }, AUTO_FINISH_DELAY_MS);
  }

  /** (Re)arma el timer que dispara commitAnswer tras SILENCE_MS de silencio real. */
  private armSilenceTimer() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      this.commitAnswer().catch((err) => logger.error({ err }, 'Error procesando respuesta'));
    }, SILENCE_MS);
  }

  private async handleRecallEvent(evt: any) {
    if (!evt?.payload || evt.payload.interviewId !== this.interviewId) return;

    if (evt.type === 'lifecycle') {
      this.emit('lifecycle', evt.payload);
      // Si Recall avisa que la llamada terminó, finalizamos y generamos el informe.
      if (evt.payload.status === 'left' && !this.finished) {
        this.autoFinish('lifecycle_left');
      }
      return;
    }

    // El candidato cerró el Meet → la entrevista terminó. Finalizamos solos
    // (sin que el reclutador tenga que apretar "Finalizar").
    if (evt.type === 'participant_left') {
      if (evt.payload.speaker !== 'bot' && !this.finished) {
        this.autoFinish('candidate_left');
      }
      return;
    }

    if (evt.type === 'speaking') {
      const { speaker, isSpeaking } = evt.payload;
      if (speaker === 'candidate') {
        // Half-duplex: si leIA está hablando (o cola de eco), lo que el micro
        // del candidato capta es la propia voz de leIA → lo ignoramos.
        if (this.isBotSpeaking()) return;
        this.emit('candidate_speaking', { isSpeaking });
        if (isSpeaking) {
          if (this.answerStartedAtMs === 0) this.answerStartedAtMs = Date.now();
          // OJO: NO cancelamos el timer en speech_on. Los eventos VAD se
          // disparan con cualquier ruido ambiente; si dejáramos que cancelen
          // el commit, un ruido de fondo postergaría la respuesta para siempre.
          // El timing lo manejan los captions reales (palabras reconocidas).
        } else {
          // speech_off: el candidato dejó de emitir energía de voz → si ya
          // tenemos texto, armamos el commit. Esto acelera respecto a esperar
          // sólo el silencio de captions.
          if (this.answerBuffer.length > 0) this.armSilenceTimer();
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

      // Sólo procesamos captions del candidato cuando leIA NO está hablando
      // (si no, sería su propio eco transcripto y atribuido al candidato).
      // En modo browser el micro es independiente del speaker (no hay eco real),
      // así que no bloqueamos por isBotSpeaking — evita la ventana muerta donde
      // el candidato habla pero sus transcripts se descartan.
      const browserMode = this.interview?.mode === 'browser';
      if (evt.payload.speaker !== 'candidate' || (!browserMode && this.isBotSpeaking())) return;

      if (evt.payload.isFinal && evt.payload.text.trim()) {
        if (this.answerStartedAtMs === 0) this.answerStartedAtMs = Date.now();
        this.answerBuffer.push(evt.payload.text);
        // Cada palabra reconocida re-arma el timer: mientras el candidato hable
        // no se dispara. Cuando se queda callado de verdad (sin captions
        // nuevos por SILENCE_MS), procesamos.
        this.armSilenceTimer();
      }
    }
  }

  private async commitAnswer() {
    if (this.finished || !this.currentTurn) return;
    if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null; }
    // Guard anti doble-commit: si dos timers se solapan, sólo procesamos una vez.
    if (this.committing) return;

    const text = this.answerBuffer.join(' ').trim();

    if (!text) {
      logger.info('commitAnswer: respuesta vacía, skip');
      return;
    }
    this.committing = true;
    this.answerBuffer = [];

    if (this.botId && this.fillerAudios.length > 0 && !this.fillerPlaying) {
      this.fillerPlaying = true;
      const pick = this.fillerAudios[Math.floor(Math.random() * this.fillerAudios.length)];
      this.markBotSpeaking(pick.durationMs);
      this.recall.playAudio({
        interviewId: this.interviewId,
        botId: this.botId,
        audioBase64: pick.audioBase64,
        mimeType: pick.mimeType,
        text: '(muletilla)',
      }).catch(() => {}).finally(() => { this.fillerPlaying = false; });
    }

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

      // Analíticas determinísticas (no las dejamos al criterio del LLM):
      // - qualityDistribution y turnsAnalyzed se calculan SIEMPRE desde los
      //   scores reales por turno.
      // - sentimentDistribution: si el LLM no devolvió una válida, caemos a la
      //   derivada de señales objetivas.
      const turnSignals = evalForLeia.map((e) => ({
        score: e.score,
        transcript: e.transcript,
        flags: e.flags,
      }));
      payload2.qualityDistribution = computeQualityDistribution(turnSignals);
      payload2.turnsAnalyzed = turnSignals.length;
      if (isEmptySentiment(payload2.sentimentDistribution)) {
        payload2.sentimentDistribution = computeSentimentFallback(turnSignals);
      }

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
    // En modo browser, reenviar eventos clave al frontend del candidato
    if (this.interview?.mode === 'browser') {
      const br = getBrowserRecall(this.interviewId);
      if (type === 'question_generated') {
        const p = payload as any;
        br.forwardQuestion(p.question, p.index, !!p.isClosing);
      } else if (type === 'interview_status') {
        const p = payload as any;
        br.forwardStatus(p.status, p.reason);
      } else if (type === 'report_ready') {
        const p = payload as any;
        br.forwardReportReady(p.kind as number);
      }
    }
  }

  /**
   * Limpia listeners y timers — necesario antes de crear un nuevo engine para
   * la misma entrevista, sino el engine viejo sigue procesando webhooks con
   * estado obsoleto.
   */
  dispose() {
    this.finished = true;
    try {
      this.recall.events.off('event', this.boundRecallHandler);
    } catch { /* noop */ }
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.autoFinishTimer) clearTimeout(this.autoFinishTimer);
  }
}

// ============================================================
// Constantes de timing del turno
// ============================================================
/** Silencio (sin captions nuevos del candidato) tras el cual procesamos su respuesta. */
const SILENCE_MS = 700;
/** Margen extra tras la voz de leIA durante el cual ignoramos el micro (eco). */
const BOT_ECHO_TAIL_MS = 500;
/** Espera tras detectar fin de llamada antes de finalizar (por si reconecta). */
const AUTO_FINISH_DELAY_MS = 4000;

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
  const e = engines.get(interviewId);
  if (e) e.dispose();
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

export function findSimilarQuestion(candidate: string, previous: string[]): string | null {
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

// Backstop: si el modelo genera una "muletilla" larga o evaluativa o de
// transición, la descartamos antes de pre-sintetizar. Mejor pocas y buenas
// que muchas y raras.
const BANNED_FILLER_PATTERNS = /(\bbuen[ií]simo\b|\bperfecto\b|\bexcelente\b|\bmuy bien\b|\bgenial\b|\bincre[ií]ble\b|\bfant[áa]stico\b|\bbrillante\b|\bqu[ée] bueno\b|\binteresante\b|\bpasemos\b|\bcambi(emos|amos|emos)\b|\botro tema\b|\bsiguiente pregunta\b|\bvamos con\b|\btengo una pregunta\b|\bte quer[ií]a preguntar\b|\buna consulta\b|\bahora te pregunto\b)/i;

export function isNeutralFiller(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  const words = t.split(/\s+/).filter(Boolean).length;
  if (words === 0 || words > 5) return false;
  if (t.length > 40) return false;
  if (BANNED_FILLER_PATTERNS.test(t)) return false;
  return true;
}

/**
 * Divide el texto en oraciones para sentence-streaming TTS.
 * Separa por `.`, `!`, `?` seguidos de espacio, manteniendo el signo.
 * Si el texto es corto (<= 60 chars) lo devuelve como un único chunk.
 */
export function splitSentences(text: string): string[] {
  if (text.length <= 60) return [text];
  // Usamos un centinela en lugar de lookbehind para compatibilidad máxima
  const parts = text
    .replace(/([.!?])\s+/g, '$1\x1E')
    .split('\x1E')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : [text];
}
