'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { clsx } from 'clsx';
import {
  apiGetInterview,
  apiStartInterview,
  apiSimulateAnswer,
  apiFinalizeInterview,
} from '@/lib/api';
import { useVoice } from '@/lib/useVoice';
import { BotTile } from '@/components/BotTile';
import { CandidateVideo } from '@/components/CandidateVideo';
import type { FaceMetrics } from '@/lib/useFaceAnalysis';
import type { InterviewDetail } from '@/lib/types';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000';

type TimelineEntry =
  | { kind: 'question'; index: number; text: string; at: number }
  | { kind: 'answer'; text: string; at: number }
  | { kind: 'evaluation'; score: number; at: number }
  | { kind: 'attention'; label: string; at: number };

export default function EntrevistaEnVivoPage() {
  const { id } = useParams<{ id: string }>();
  const [meta, setMeta] = useState<InterviewDetail | null>(null);
  const [connected, setConnected] = useState(false);
  const [drivers, setDrivers] = useState<any>(null);
  const [status, setStatus] = useState<string>('pendiente');
  const [botSpeakingRemote, setBotSpeakingRemote] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [transcript, setTranscript] = useState<{ speaker: string; text: string; at: number }[]>([]);
  const [reportsReady, setReportsReady] = useState<{ kind: 1 | 2 }[]>([]);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [autoListenAfterSpeak, setAutoListenAfterSpeak] = useState(true);
  const [autoSendOnSilence, setAutoSendOnSilence] = useState(true);
  const [waitingForLeia, setWaitingForLeia] = useState(false);
  const [isClarification, setIsClarification] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [showPanel, setShowPanel] = useState(true);
  const [face, setFace] = useState<FaceMetrics | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [fillers, setFillers] = useState<string[]>([]);

  // Acumulador de comportamiento facial (segundos por estado).
  const behaviorAccRef = useRef({
    durationSec: 0,
    faceVisibleSec: 0,
    cameraOffSec: 0,
    attentionSec: { attentive: 0, reading: 0, distracted: 0, absent: 0 },
    readingEvents: 0,
    expressionCounts: {} as Record<string, number>,
    samples: 0,
  });
  const lastSampleAtRef = useRef<number>(Date.now());

  const wsRef = useRef<WebSocket | null>(null);
  const lastSpokenRef = useRef<string>('');
  const lastSentTextRef = useRef<string>('');
  const lastAttentionRef = useRef<string>('attentive');
  const captionsEndRef = useRef<HTMLDivElement | null>(null);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lang = meta?.job?.requirements.language === 'en' ? 'en-US' : 'es-AR';

  const handleSilence = async (text: string) => {
    if (!autoSendOnSilence) return;
    if (text === lastSentTextRef.current) return;
    lastSentTextRef.current = text;
    await sendAnswer(text);
  };

  const voice = useVoice({ lang, onSilence: handleSilence, silenceMs: 1500, minWordsForSilence: 3 });

  // Cronómetro de duración
  useEffect(() => {
    if (status !== 'en_curso') return;
    const t = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => {
    captionsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, voice.interimText]);

  // Hidratar el estado desde la BD.
  useEffect(() => {
    (async () => {
      try {
        const data = await apiGetInterview(id);
        setMeta(data);
        setStatus(data.status);

        if (data.transcripts?.length) {
          setTranscript(
            data.transcripts.map((t) => ({
              speaker: t.speaker,
              text: t.text,
              at: new Date(t.receivedAt).getTime(),
            }))
          );
        }
        if (data.turns?.length) {
          const last = data.turns[data.turns.length - 1];
          setCurrentQuestion(last.question);
          setQuestionIndex(last.index);
          const entries: TimelineEntry[] = [];
          for (const t of data.turns) {
            entries.push({
              kind: 'question',
              index: t.index,
              text: t.question,
              at: new Date(t.questionAt).getTime(),
            });
            if (t.answerTranscript) {
              entries.push({
                kind: 'answer',
                text: t.answerTranscript,
                at: t.answerAt ? new Date(t.answerAt).getTime() : 0,
              });
            }
            if (t.evaluationId) {
              const ev = data.evaluations.find((e) => e.id === t.evaluationId);
              if (ev) {
                entries.push({
                  kind: 'evaluation',
                  score: ev.score,
                  at: new Date(ev.createdAt).getTime(),
                });
              }
            }
          }
          setTimeline(entries);
        }
        if (data.reports?.length) {
          setReportsReady(data.reports.map((r) => ({ kind: r.kind })));
        }
        if (data.status === 'completada') setFinished(true);
        if (data.startedAt) {
          const since = Math.max(
            0,
            Math.round((Date.now() - new Date(data.startedAt).getTime()) / 1000)
          );
          setElapsedSec(since);
        }
      } catch (e: any) {
        setError(e.message);
      }
    })();
  }, [id]);

  // WS
  useEffect(() => {
    if (!id) return;
    const ws = new WebSocket(`${WS_URL}/ws/interview/${id}`);
    wsRef.current = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      setConnected(true);
      setError((prev) => (prev === 'Error de conexión con el servidor' ? null : prev));
    };
    ws.onclose = () => {
      setConnected(false);
      if (!opened) setError('Error de conexión con el servidor');
    };
    ws.onerror = () => {
      if (!opened) setError('Error de conexión con el servidor');
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      handleWs(msg);
    };
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Loguear cambios de atención al timeline (uno por vez) + acumular métricas.
  useEffect(() => {
    if (status !== 'en_curso') return;
    const now = Date.now();
    const dtSec = (now - lastSampleAtRef.current) / 1000;
    lastSampleAtRef.current = now;
    const acc = behaviorAccRef.current;
    acc.durationSec += dtSec;
    if (!cameraOn) {
      acc.cameraOffSec += dtSec;
    } else if (face?.faceDetected) {
      acc.faceVisibleSec += dtSec;
    }
    if (face) {
      acc.attentionSec[face.attention] = (acc.attentionSec[face.attention] ?? 0) + dtSec;
      if (face.expression) {
        acc.expressionCounts[face.expression] = (acc.expressionCounts[face.expression] ?? 0) + 1;
      }
      acc.samples += 1;
      if (face.attention !== lastAttentionRef.current) {
        if (face.attention === 'reading') acc.readingEvents += 1;
        lastAttentionRef.current = face.attention;
        const label =
          face.attention === 'reading'
            ? 'mirada baja prolongada (¿lectura?)'
            : face.attention === 'absent'
              ? 'cara fuera de cámara'
              : face.attention === 'distracted'
                ? 'mirada lateral'
                : 'atento';
        if (face.attention !== 'attentive') {
          setTimeline((tl) => [...tl, { kind: 'attention', label, at: Date.now() }]);
        }
      }
    }
  }, [face, cameraOn, status]);

  function buildBehaviorPayload() {
    const acc = behaviorAccRef.current;
    const total = acc.durationSec || 1;
    let dominant = 'neutral';
    let dominantCount = 0;
    const distribution: Record<string, number> = {};
    const totalCounts = Object.values(acc.expressionCounts).reduce((s, n) => s + n, 0) || 1;
    for (const [k, v] of Object.entries(acc.expressionCounts)) {
      distribution[k] = v / totalCounts;
      if (v > dominantCount) {
        dominantCount = v;
        dominant = k;
      }
    }
    return {
      durationSec: Math.round(total),
      faceVisibleSec: Math.round(acc.faceVisibleSec),
      cameraOffSec: Math.round(acc.cameraOffSec),
      attentionSec: {
        attentive: Math.round(acc.attentionSec.attentive ?? 0),
        reading: Math.round(acc.attentionSec.reading ?? 0),
        distracted: Math.round(acc.attentionSec.distracted ?? 0),
        absent: Math.round(acc.attentionSec.absent ?? 0),
      },
      readingEvents: acc.readingEvents,
      dominantExpression: dominant,
      expressionDistribution: distribution,
    };
  }

  function handleWs(msg: any) {
    switch (msg.type) {
      case 'hello':
        setDrivers(msg.drivers);
        break;
      case 'interview_status':
        setStatus(msg.status);
        if (msg.status === 'completada') setFinished(true);
        break;
      case 'question_generated': {
        if (recoveryTimerRef.current) {
          clearTimeout(recoveryTimerRef.current);
          recoveryTimerRef.current = null;
        }
        setCurrentQuestion(msg.question);
        setQuestionIndex(msg.index ?? 0);
        setIsClarification(!!msg.isClarification);
        setWaitingForLeia(false);
        setTimeline((t) => [
          ...t,
          { kind: 'question', index: msg.index ?? 0, text: msg.question, at: Date.now() },
        ]);
        if (msg.question && msg.question !== lastSpokenRef.current) {
          lastSpokenRef.current = msg.question;
          voice.stopListening();
          voice.resetFinal();
          voice.speak(msg.question, {
            onEnd: () => {
              if (autoListenAfterSpeak && !msg.isClosing && status !== 'completada') {
                lastSentTextRef.current = '';
                setTimeout(() => voice.startListening(), 250);
              }
            },
          });
        }
        break;
      }
      case 'audio_generated':
        setBotSpeakingRemote(true);
        setTimeout(() => setBotSpeakingRemote(false), Math.min(msg.durationMs ?? 2000, 6000));
        break;
      case 'caption_received':
        setTranscript((t) => [...t, { speaker: msg.speaker, text: msg.text, at: Date.now() }]);
        if (msg.speaker === 'candidate' && msg.isFinal) {
          setTimeline((tl) => [...tl, { kind: 'answer', text: msg.text, at: Date.now() }]);
        }
        break;
      case 'leia_evaluation_ready':
        setTimeline((tl) => [
          ...tl,
          { kind: 'evaluation', score: msg.evaluation.score, at: Date.now() },
        ]);
        break;
      case 'report_ready':
        setReportsReady((r) => [...r.filter((x) => x.kind !== msg.kind), { kind: msg.kind }]);
        break;
      case 'interview_finished':
        setFinished(true);
        voice.stopListening();
        voice.stopSpeaking();
        break;
      case 'fillers_ready':
        if (Array.isArray(msg.fillers)) setFillers(msg.fillers);
        break;
      case 'error':
        setError(msg.message);
        break;
    }
  }

  // Las muletillas las genera leIA al iniciar la entrevista, contextualizadas al
  // puesto y candidato. Solo dejamos un mínimo de fallback si todavía no llegaron.
  const FALLBACK_FILLERS = ['Un segundo.', 'Mhm, dejame pensar.'];
  function pickFiller() {
    const pool = fillers.length > 0 ? fillers : FALLBACK_FILLERS;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  async function sendAnswer(text: string) {
    if (!text.trim()) return;
    voice.stopListening();
    setWaitingForLeia(true);
    voice.speak(pickFiller());

    // Watchdog de recuperación: si leIA no responde en 25 s (error de red, backend
    // colgado), reabrimos el micrófono para no dejar al candidato esperando para siempre.
    if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
    recoveryTimerRef.current = setTimeout(() => {
      setWaitingForLeia(false);
      setError('leIA tardó demasiado en responder. Probá hablar de nuevo o repetí la pregunta.');
      if (autoListenAfterSpeak) {
        lastSentTextRef.current = '';
        voice.startListening();
      }
    }, 25000);

    try {
      await apiSimulateAnswer(id, text);
    } catch (e: any) {
      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }
      setError(e.message);
      setWaitingForLeia(false);
      if (autoListenAfterSpeak) {
        lastSentTextRef.current = '';
        voice.startListening();
      }
    }
    voice.resetFinal();
  }

  async function onStart() {
    setStarting(true);
    try {
      await apiStartInterview(id);
      if (meta?.meetUrl) window.open(meta.meetUrl, '_blank');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  }

  async function onForceFinalize() {
    if (!confirm('¿Cerrar la entrevista y generar los informes?')) return;
    voice.stopListening();
    voice.stopSpeaking();
    try {
      const behavior = buildBehaviorPayload();
      await apiFinalizeInterview(id, behavior);
      setFinished(true);
    } catch (e: any) {
      setError(e.message);
    }
  }

  function toggleMic() {
    if (voice.listening) voice.stopListening();
    else voice.startListening();
  }

  function replayCurrentQuestion() {
    if (!currentQuestion) return;
    voice.stopListening();
    voice.speak(currentQuestion, {
      onEnd: () => {
        if (autoListenAfterSpeak && status === 'en_curso' && !finished) {
          setTimeout(() => voice.startListening(), 250);
        }
      },
    });
  }

  const liveText = (voice.finalText + ' ' + voice.interimText).trim();
  const botSpeaking = voice.speaking || botSpeakingRemote;
  const botStatusText = waitingForLeia
    ? 'Pensando…'
    : botSpeaking
      ? 'Hablando…'
      : voice.listening
        ? 'Escuchándote…'
        : currentQuestion
          ? 'Esperando'
          : 'Lista para iniciar';

  const minutes = Math.floor(elapsedSec / 60);
  const seconds = elapsedSec % 60;

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Top bar */}
      <header className="px-6 py-3 flex items-center justify-between border-b border-white/5 bg-slate-900/60 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link
            href={`/entrevistas/${id}`}
            className="text-xs text-slate-300 hover:text-white"
          >
            ← Volver
          </Link>
          <div className="leading-tight">
            <div className="text-sm font-semibold">
              {meta?.candidate?.name ?? 'Entrevista'}
            </div>
            <div className="text-[11px] text-slate-400">
              {meta?.job?.title}
              {drivers && (
                <>
                  {' · leIA '}
                  <span className="text-yellow-300">{drivers.leia}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs">
          {status === 'en_curso' && (
            <span className="font-mono">
              {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
            </span>
          )}
          <span
            className={clsx(
              'flex items-center gap-1.5',
              connected ? 'text-green-300' : 'text-red-300'
            )}
          >
            <span
              className={clsx(
                'w-2 h-2 rounded-full',
                connected ? 'bg-green-400 animate-pulse' : 'bg-red-500'
              )}
            />
            {connected ? 'En vivo' : 'Sin conexión'}
          </span>
          <span className="badge bg-white/10 text-white capitalize">{status}</span>
          <button
            onClick={() => setShowPanel((s) => !s)}
            className="text-xs px-2 py-1 rounded-lg bg-white/10 hover:bg-white/15"
            title={showPanel ? 'Ocultar panel' : 'Mostrar panel'}
          >
            {showPanel ? '⇥ Panel' : '⇤ Panel'}
          </button>
        </div>
      </header>

      {error && (
        <div className="mx-6 mt-3 p-2 bg-red-900/50 border border-red-500/50 rounded-lg text-red-200 text-xs">
          {error}
        </div>
      )}

      {/* Main grid: tiles + panel */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col p-4 gap-4">
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
            <BotTile
              speaking={botSpeaking}
              listening={voice.listening}
              thinking={waitingForLeia}
              status={botStatusText}
            />
            <CandidateVideo
              candidateName={meta?.candidate?.name ?? 'Vos'}
              cameraOn={cameraOn}
              micOn={voice.listening}
              speaking={voice.listening && !botSpeaking}
              onMetrics={setFace}
            />
          </div>

          {/* Subtítulo de la pregunta + transcript en vivo */}
          {currentQuestion && (
            <div
              className={clsx(
                'rounded-2xl px-4 py-3 text-sm border max-h-32 overflow-y-auto',
                isClarification
                  ? 'bg-yellow-500/10 border-yellow-500/30'
                  : 'bg-white/5 border-white/10'
              )}
            >
              <div className="flex items-center gap-2 mb-1 text-[10px] uppercase text-slate-400">
                {isClarification ? (
                  <span className="text-yellow-300">Aclaración</span>
                ) : (
                  <span>Pregunta {questionIndex + 1}</span>
                )}
                <button
                  onClick={replayCurrentQuestion}
                  className="ml-auto text-slate-300 hover:text-white"
                  title="Volver a escuchar"
                >
                  ↻
                </button>
              </div>
              <div>{currentQuestion}</div>
              {(voice.listening || liveText) && (
                <div className="mt-2 pt-2 border-t border-white/10 text-xs">
                  <span className="text-[10px] uppercase text-slate-400 mr-2">
                    {meta?.candidate?.name ?? 'Vos'}
                  </span>
                  <span className="text-white">{voice.finalText}</span>{' '}
                  <span className="text-slate-400 italic">{voice.interimText}</span>
                </div>
              )}
            </div>
          )}

          {/* Controles inferiores estilo Meet */}
          <div className="flex items-center justify-center gap-3 py-2">
            {status === 'agendada' && (
              <button
                onClick={onStart}
                disabled={!connected || starting}
                className="px-5 py-3 rounded-full bg-primary-600 hover:bg-primary-700 disabled:bg-slate-700 font-semibold"
              >
                {starting ? 'Iniciando…' : '▶ Iniciar entrevista'}
              </button>
            )}
            {status === 'en_curso' && (
              <>
                <CircleButton
                  active={voice.listening}
                  onClick={toggleMic}
                  disabled={botSpeaking || !voice.supported}
                  activeClass="bg-red-600 hover:bg-red-700"
                  inactiveClass="bg-white/10 hover:bg-white/20"
                  title={voice.listening ? 'Mute' : 'Hablar'}
                >
                  {voice.listening ? '🎙️' : '🔇'}
                </CircleButton>
                <CircleButton
                  active={cameraOn}
                  onClick={() => setCameraOn((c) => !c)}
                  activeClass="bg-white/10 hover:bg-white/20"
                  inactiveClass="bg-red-600 hover:bg-red-700"
                  title={cameraOn ? 'Apagar cámara' : 'Prender cámara'}
                >
                  {cameraOn ? '📹' : '📷'}
                </CircleButton>
                <CircleButton
                  onClick={replayCurrentQuestion}
                  activeClass="bg-white/10 hover:bg-white/20"
                  inactiveClass="bg-white/10 hover:bg-white/20"
                  title="Repetir pregunta"
                >
                  ↻
                </CircleButton>
                <CircleButton
                  onClick={onForceFinalize}
                  activeClass="bg-red-700 hover:bg-red-800"
                  inactiveClass="bg-red-700 hover:bg-red-800"
                  title="Cerrar entrevista"
                >
                  ✕
                </CircleButton>
              </>
            )}
            {finished && reportsReady.length > 0 && (
              <div className="flex gap-2">
                {reportsReady.some((r) => r.kind === 1) && (
                  <Link
                    href={`/entrevistas/${id}/informe-1`}
                    className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/15 text-sm"
                  >
                    Informe 1
                  </Link>
                )}
                {reportsReady.some((r) => r.kind === 2) && (
                  <Link
                    href={`/entrevistas/${id}/informe-2`}
                    className="px-4 py-2 rounded-full bg-primary-600 hover:bg-primary-700 text-sm"
                  >
                    Informe 2
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Panel lateral */}
        {showPanel && (
          <aside className="w-80 border-l border-white/5 bg-slate-900/40 p-4 overflow-y-auto space-y-4 hidden lg:block">
            {/* Estado del candidato */}
            <section className="bg-white/5 rounded-xl p-3 border border-white/10">
              <h3 className="text-xs uppercase tracking-wider text-slate-400 mb-2">
                Análisis del candidato
              </h3>
              {!face?.ready ? (
                <div className="text-xs text-slate-500">
                  {cameraOn ? 'Cargando modelo de análisis facial…' : 'Cámara apagada.'}
                </div>
              ) : (
                <div className="space-y-2 text-sm">
                  <Row
                    label="Atención"
                    value={
                      face.attention === 'attentive'
                        ? 'Atento'
                        : face.attention === 'reading'
                          ? 'Mirando hacia abajo'
                          : face.attention === 'distracted'
                            ? 'Mirada lateral'
                            : 'Sin cara'
                    }
                    tone={
                      face.attention === 'attentive'
                        ? 'good'
                        : face.attention === 'absent'
                          ? 'bad'
                          : 'warn'
                    }
                  />
                  <Row label="Expresión" value={face.expressionLabel} />
                  <Row label="Presencia" value={`${(face.presenceRatio * 100).toFixed(0)}%`} />
                  {face.isLikelyReading && (
                    <div className="mt-2 p-2 rounded-lg bg-amber-500/15 border border-amber-400/40 text-amber-100 text-xs">
                      Posible lectura: mirada hacia abajo prolongada.
                    </div>
                  )}
                  {face.error && (
                    <div className="text-[11px] text-red-300">{face.error}</div>
                  )}
                </div>
              )}
            </section>

            {/* Timeline */}
            <section className="bg-white/5 rounded-xl p-3 border border-white/10">
              <h3 className="text-xs uppercase tracking-wider text-slate-400 mb-2">
                Timeline
              </h3>
              <div className="space-y-2 text-xs max-h-72 overflow-y-auto">
                {timeline.length === 0 ? (
                  <p className="text-slate-500">Sin actividad todavía.</p>
                ) : (
                  timeline.slice(-30).map((t, i) => (
                    <div key={i} className="border-l-2 border-primary-500/60 pl-2">
                      {t.kind === 'question' && (
                        <>
                          <div className="uppercase text-[9px] text-slate-400">
                            Pregunta #{t.index + 1}
                          </div>
                          <div className="text-slate-200 line-clamp-2">{t.text}</div>
                        </>
                      )}
                      {t.kind === 'answer' && (
                        <>
                          <div className="uppercase text-[9px] text-slate-400">Respuesta</div>
                          <div className="text-slate-200 line-clamp-2">{t.text}</div>
                        </>
                      )}
                      {t.kind === 'evaluation' && (
                        <>
                          <div className="uppercase text-[9px] text-slate-400">leIA evaluó</div>
                          <div className="text-yellow-300">{t.score.toFixed(1)}/10</div>
                        </>
                      )}
                      {t.kind === 'attention' && (
                        <>
                          <div className="uppercase text-[9px] text-amber-300">Atención</div>
                          <div className="text-slate-300">{t.label}</div>
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Opciones */}
            <section className="bg-white/5 rounded-xl p-3 border border-white/10 space-y-2">
              <h3 className="text-xs uppercase tracking-wider text-slate-400 mb-1">
                Opciones
              </h3>
              <label className="flex items-center gap-2 text-[11px] text-slate-300">
                <input
                  type="checkbox"
                  checked={autoSendOnSilence}
                  onChange={(e) => setAutoSendOnSilence(e.target.checked)}
                />
                Enviar respuesta al hacer pausa
              </label>
              <label className="flex items-center gap-2 text-[11px] text-slate-300">
                <input
                  type="checkbox"
                  checked={autoListenAfterSpeak}
                  onChange={(e) => setAutoListenAfterSpeak(e.target.checked)}
                />
                Abrir micrófono cuando leIA termina
              </label>
              {voice.voices.length > 0 && (
                <div className="pt-2">
                  <label className="text-[11px] text-slate-400 mb-1 block">Voz de leIA</label>
                  <select
                    className="w-full text-xs px-2 py-1.5 bg-white/5 border border-white/20 rounded-lg text-white"
                    value={voice.selectedVoice?.voiceURI ?? ''}
                    onChange={(e) => {
                      const v = voice.voices.find((vv) => vv.voiceURI === e.target.value);
                      voice.setSelectedVoice(v ?? null);
                    }}
                  >
                    {voice.voices
                      .filter((v) => v.lang.startsWith('es') || v.lang.startsWith('en'))
                      .map((v) => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {v.name} · {v.lang}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </section>
          </aside>
        )}
      </div>
      <div ref={captionsEndRef} />
    </div>
  );
}

function CircleButton({
  children,
  active,
  onClick,
  disabled,
  activeClass,
  inactiveClass,
  title,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  activeClass: string;
  inactiveClass: string;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={clsx(
        'w-12 h-12 rounded-full flex items-center justify-center text-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed',
        active ? activeClass : inactiveClass
      )}
    >
      {children}
    </button>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'warn' | 'bad';
}) {
  const color =
    tone === 'good'
      ? 'text-green-300'
      : tone === 'warn'
        ? 'text-amber-300'
        : tone === 'bad'
          ? 'text-red-300'
          : 'text-white';
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-400">{label}</span>
      <span className={clsx('font-medium', color)}>{value}</span>
    </div>
  );
}
