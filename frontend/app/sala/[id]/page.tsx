'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useVoice } from '@/lib/useVoice';

const WS_URL  = process.env.NEXT_PUBLIC_WS_URL  ?? 'ws://localhost:4000';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const VIDEO_IDLE = `${API_URL}/bot-stage-video/idle`;
const VIDEO_TALK = `${API_URL}/bot-stage-video/talk`;

interface SalaInfo {
  interviewId: string;
  status:        string;
  jobTitle:      string;
  company:       string;
  candidateName: string;
}

type Phase = 'loading' | 'lobby' | 'running' | 'finished' | 'error';

// ─────────────────────────────────────────────────────────────────────────────
export default function SalaPage() {
  const { id } = useParams<{ id: string }>();

  const [info,    setInfo]    = useState<SalaInfo | null>(null);
  const [phase,   setPhase]   = useState<Phase>('loading');
  const [errMsg,  setErrMsg]  = useState('');

  // leIA video
  const idleRef = useRef<HTMLVideoElement>(null);
  const talkRef = useRef<HTMLVideoElement>(null);

  // Candidate self-view (shared between lobby + running)
  const selfRef = useRef<HTMLVideoElement>(null);

  // State
  const [leiaSpeaking,  setLeiaSpeaking]  = useState(false);
  const [leiaThinking,  setLeiaThinking]  = useState(false);
  const [subtitle,      setSubtitle]      = useState('');
  const [micOn,         setMicOn]         = useState(true);
  const [cameraOn,      setCameraOn]      = useState(true);
  const [elapsed,       setElapsed]       = useState(0);

  // Refs
  const streamRef      = useRef<MediaStream | null>(null);
  const lobbyStreamRef = useRef<MediaStream | null>(null);
  const recorderRef    = useRef<MediaRecorder | null>(null);
  const chunksRef      = useRef<Blob[]>([]);
  const wsRef          = useRef<WebSocket | null>(null);
  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null);

  // Audio queue
  const audioQueueRef = useRef<Array<{ mimeType: string; audioBase64: string; durationMs: number }>>([]);
  const playingRef    = useRef(false);
  const watchdogRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Voice recognition ──────────────────────────────────────────────────────
  const { listening, interimText, startListening, stopListening, resetFinal } = useVoice({
    silenceMs: 2000,
    onSilence: (text) => {
      if (!text.trim() || phase !== 'running') return;
      wsRef.current?.send(JSON.stringify({ type: 'transcript', text, isFinal: true }));
      resetFinal();
    },
  });

  // ── Load sala info ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_URL}/api/sala/${id}/info`)
      .then(r => { if (!r.ok) throw new Error('sala_no_encontrada'); return r.json(); })
      .then((d: SalaInfo) => { setInfo(d); setPhase('lobby'); })
      .catch(e => { setErrMsg(e?.message ?? 'Error'); setPhase('error'); });
  }, [id]);

  // ── Lobby camera preview ───────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'lobby') return;
    let alive = true;
    navigator.mediaDevices
      .getUserMedia({ video: { width: 1280, height: 720, facingMode: 'user' }, audio: false })
      .then(s => {
        if (!alive) { s.getTracks().forEach(t => t.stop()); return; }
        lobbyStreamRef.current = s;
        if (selfRef.current) { selfRef.current.srcObject = s; }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [phase]);

  // ── Video switching (idle ↔ talk) ──────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'running') return;
    const idle = idleRef.current;
    const talk = talkRef.current;
    if (!idle || !talk) return;
    if (leiaSpeaking) {
      idle.style.display = 'none';
      idle.pause();
      talk.style.display = 'block';
      talk.currentTime = 0;
      talk.play().catch(() => {});
    } else {
      talk.style.display = 'none';
      talk.pause();
      idle.style.display = 'block';
      idle.play().catch(() => {});
    }
  }, [leiaSpeaking, phase]);

  // ── Audio playback queue ───────────────────────────────────────────────────
  const playNext = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      playingRef.current = false;
      setLeiaSpeaking(false);
      setLeiaThinking(false);
      if (micOn) startListening();
      return;
    }
    const item = audioQueueRef.current.shift()!;
    playingRef.current = true;
    setLeiaSpeaking(true);
    stopListening();

    const bytes = atob(item.audioBase64);
    const arr   = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const url   = URL.createObjectURL(new Blob([arr], { type: item.mimeType }));

    const audio = new Audio(url);
    const done  = () => { URL.revokeObjectURL(url); if (watchdogRef.current) clearTimeout(watchdogRef.current); setTimeout(playNext, 40); };
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);

    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = setTimeout(() => { audio.pause(); done(); }, item.durationMs + 3000);
  }, [micOn, startListening, stopListening]);

  const enqueueAudio = useCallback((mimeType: string, audioBase64: string, durationMs: number) => {
    audioQueueRef.current.push({ mimeType, audioBase64, durationMs });
    setLeiaThinking(false);
    if (!playingRef.current) playNext();
  }, [playNext]);

  // ── Join call ──────────────────────────────────────────────────────────────
  const joinCall = useCallback(async () => {
    // Stop lobby preview
    lobbyStreamRef.current?.getTracks().forEach(t => t.stop());
    lobbyStreamRef.current = null;

    setPhase('running');

    // Start full stream (video + audio)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      stream.getVideoTracks().forEach(t => (t.enabled = cameraOn));
      stream.getAudioTracks().forEach(t => (t.enabled  = micOn));
      if (selfRef.current) selfRef.current.srcObject = stream;

      // Recording
      const mr = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus' });
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(5000);
      recorderRef.current = mr;
    } catch { /* camera/mic optional */ }

    // Preload talk video
    talkRef.current?.load();

    // Timer
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);

    // WebSocket
    const ws = new WebSocket(`${WS_URL}/ws/sala/${id}`);
    wsRef.current = ws;
    ws.onopen    = () => { ws.send(JSON.stringify({ type: 'ready' })); setLeiaThinking(true); };
    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === 'audio')    enqueueAudio(msg.mimeType, msg.audioBase64, msg.durationMs);
        if (msg.type === 'question') setSubtitle(msg.text ?? '');
        if (msg.type === 'status' && msg.status === 'en_curso') setLeiaThinking(true);
        if (msg.type === 'finished') endCall();
      } catch { /* noop */ }
    };

    // Keepalive
    const ka = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, 25000);
    ws.onclose = () => clearInterval(ka);
  }, [id, cameraOn, micOn, enqueueAudio]); // eslint-disable-line

  // ── End call ───────────────────────────────────────────────────────────────
  const endCall = useCallback(async () => {
    setPhase('finished');
    stopListening();
    if (timerRef.current) clearInterval(timerRef.current);
    if (watchdogRef.current) clearTimeout(watchdogRef.current);

    const mr = recorderRef.current;
    if (mr && mr.state !== 'inactive') {
      mr.stop();
      await new Promise<void>(res => { mr.onstop = () => res(); });
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      if (blob.size > 1000) {
        fetch(`${API_URL}/api/sala/${id}/recording`, {
          method: 'POST',
          headers: { 'Content-Type': 'video/webm' },
          body: blob,
        }).catch(() => {});
      }
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    wsRef.current?.close();
  }, [id, stopListening]);

  // ── Mic / camera toggles ───────────────────────────────────────────────────
  const toggleMic = useCallback(() => {
    const next = !micOn;
    setMicOn(next);
    streamRef.current?.getAudioTracks().forEach(t => (t.enabled = next));
    if (!next) stopListening();
  }, [micOn, stopListening]);

  const toggleCam = useCallback(() => {
    const next = !cameraOn;
    setCameraOn(next);
    streamRef.current?.getVideoTracks().forEach(t => (t.enabled = next));
  }, [cameraOn]);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  useEffect(() => () => {
    if (timerRef.current)  clearInterval(timerRef.current);
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    wsRef.current?.close();
    streamRef.current?.getTracks().forEach(t => t.stop());
    lobbyStreamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  // ── Phase routing ──────────────────────────────────────────────────────────
  if (phase === 'loading') return <Loading />;
  if (phase === 'error')   return <ErrorScreen msg={errMsg} />;
  if (phase === 'finished') return <FinishedScreen info={info} elapsed={elapsed} fmt={fmt} />;

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: '#202124', fontFamily: 'Google Sans, Roboto, Arial, sans-serif' }}>

      {/* ── Active call UI ─────────────────────────────────────────── */}
      {phase === 'running' && (
        <>
          {/* Top bar */}
          <div className="absolute top-0 inset-x-0 h-14 flex items-center justify-between px-5 z-10">
            <div className="flex items-center gap-2">
              <span className="text-white font-medium text-base">{info?.company ?? 'Entrevista'}</span>
              {info?.jobTitle && (
                <span className="hidden sm:inline text-sm" style={{ color: '#9aa0a6' }}>· {info.jobTitle}</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {elapsed > 0 && (
                <span className="text-sm tabular-nums" style={{ color: '#9aa0a6' }}>{fmt(elapsed)}</span>
              )}
              <span className="flex items-center gap-1.5 text-xs" style={{ color: '#f28b82' }}>
                <span className="w-2 h-2 rounded-full bg-[#ea4335] animate-pulse" />
                REC
              </span>
            </div>
          </div>

          {/* Main content area */}
          <div className="absolute inset-0 pt-14 pb-[72px] flex items-center justify-center p-4">
            {/* leIA tile */}
            <div className="relative w-full h-full max-w-5xl" style={{ aspectRatio: '16/9', maxHeight: '100%' }}>
              <div
                className="absolute inset-0 rounded-2xl overflow-hidden"
                style={{ background: '#3c4043', boxShadow: leiaSpeaking ? '0 0 0 3px #1a73e8' : '0 0 0 1px #5f6368' }}
              >
                {/* Idle video */}
                <video
                  ref={idleRef}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="absolute inset-0 w-full h-full object-cover"
                >
                  <source src={VIDEO_IDLE} type="video/mp4" />
                </video>

                {/* Talk video (hidden until speaking) */}
                <video
                  ref={talkRef}
                  loop
                  muted
                  playsInline
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{ display: 'none' }}
                >
                  <source src={VIDEO_TALK} type="video/mp4" />
                </video>

                {/* Thinking indicator */}
                {leiaThinking && !leiaSpeaking && (
                  <div className="absolute inset-0 flex items-end justify-start p-4 pointer-events-none">
                    <div className="flex gap-1.5 bg-black/50 backdrop-blur-sm px-3 py-2 rounded-full">
                      {[0, 150, 300].map(d => (
                        <span
                          key={d}
                          className="w-2 h-2 rounded-full bg-white animate-bounce"
                          style={{ animationDelay: `${d}ms` }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* leIA name tag */}
                <div className="absolute bottom-3 left-3 flex items-center gap-2">
                  <span
                    className="text-white text-sm font-medium px-2 py-0.5 rounded"
                    style={{ background: 'rgba(0,0,0,0.55)' }}
                  >
                    leIA
                  </span>
                  {leiaSpeaking && (
                    <span className="flex gap-0.5">
                      {[1, 2, 3].map(i => (
                        <span
                          key={i}
                          className="w-0.5 rounded-full bg-white opacity-80"
                          style={{
                            height: `${8 + i * 4}px`,
                            animation: `eq-bar${i} 0.5s ease-in-out infinite alternate`,
                            animationDelay: `${i * 80}ms`,
                          }}
                        />
                      ))}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Captions (current question) */}
          {subtitle && (
            <div
              className="absolute z-10 inset-x-0 flex justify-center pointer-events-none"
              style={{ bottom: 88 }}
            >
              <div
                className="mx-4 max-w-2xl text-center text-white text-[15px] leading-relaxed px-5 py-2.5 rounded-xl"
                style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)' }}
              >
                {subtitle}
              </div>
            </div>
          )}

          {/* Interim transcript */}
          {interimText && (
            <div className="absolute z-10 inset-x-0 flex justify-center" style={{ bottom: subtitle ? 140 : 88 }}>
              <span className="text-sm italic" style={{ color: '#9aa0a6' }}>{interimText}</span>
            </div>
          )}

          {/* Self-cam PiP */}
          <div
            className="absolute z-20 rounded-xl overflow-hidden"
            style={{
              bottom: 84,
              right: 16,
              width: 180,
              height: 101,
              background: '#3c4043',
              border: listening ? '2px solid #34a853' : '2px solid #5f6368',
              transition: 'border-color 0.2s',
            }}
          >
            {cameraOn ? (
              <video
                ref={selfRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-xs" style={{ color: '#9aa0a6' }}>Sin cámara</span>
              </div>
            )}
            <div
              className="absolute bottom-1.5 left-2 text-white text-[11px] font-medium px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(0,0,0,0.55)' }}
            >
              {info?.candidateName ?? 'Tú'} (tú)
            </div>
          </div>

          {/* Control bar */}
          <div
            className="absolute bottom-0 inset-x-0 h-[72px] flex items-center justify-center gap-3 z-30"
            style={{ background: 'rgba(32,33,36,0.97)', borderTop: '1px solid #3c4043' }}
          >
            <CallBtn active={micOn}    onClick={toggleMic}  icon={<MicIcon />}      offIcon={<MicOffIcon />}    label={micOn    ? 'Silenciar'    : 'Activar mic'} />
            <CallBtn active={cameraOn} onClick={toggleCam}  icon={<CamIcon />}      offIcon={<CamOffIcon />}    label={cameraOn ? 'Apagar cámara' : 'Encender cam'} />
            <button
              onClick={endCall}
              title="Salir de la entrevista"
              className="flex flex-col items-center gap-1 group"
            >
              <span className="w-12 h-12 rounded-full flex items-center justify-center transition-colors" style={{ background: '#ea4335' }}>
                <PhoneIcon />
              </span>
              <span className="text-[11px]" style={{ color: '#9aa0a6' }}>Salir</span>
            </button>
          </div>
        </>
      )}

      {/* ── Lobby ──────────────────────────────────────────────────── */}
      {phase === 'lobby' && (
        <div className="h-full flex flex-col items-center justify-center px-4 gap-6">

          {/* Header */}
          <div className="text-center">
            <p className="text-sm font-medium mb-1" style={{ color: '#8ab4f8' }}>{info?.company}</p>
            <h1 className="text-2xl font-semibold text-white">{info?.jobTitle ?? 'Entrevista con leIA'}</h1>
            {info?.candidateName && (
              <p className="mt-1 text-sm" style={{ color: '#9aa0a6' }}>Hola, {info.candidateName}</p>
            )}
          </div>

          {/* Camera preview */}
          <div
            className="relative rounded-2xl overflow-hidden"
            style={{
              width: 'min(480px, calc(100vw - 32px))',
              aspectRatio: '4/3',
              background: '#3c4043',
            }}
          >
            <video
              ref={selfRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />
            {/* Lobby controls overlay */}
            <div
              className="absolute bottom-0 inset-x-0 h-14 flex items-center justify-center gap-3"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)' }}
            >
              <LobbyToggle active={micOn}    onClick={() => setMicOn(v => !v)}    icon={<MicIcon />}  offIcon={<MicOffIcon />}  label="Mic" />
              <LobbyToggle active={cameraOn} onClick={() => setCameraOn(v => !v)} icon={<CamIcon />}  offIcon={<CamOffIcon />}  label="Cámara" />
            </div>
          </div>

          {/* Join button */}
          <button
            onClick={joinCall}
            className="px-10 py-3.5 rounded-full text-base font-semibold text-white transition-all hover:brightness-110 active:scale-95"
            style={{ background: '#1a73e8', minWidth: 220 }}
          >
            Unirse ahora
          </button>

          <p className="text-center text-sm max-w-xs" style={{ color: '#9aa0a6' }}>
            leIA conducirá la entrevista. Hablá en voz alta para responder cada pregunta.
          </p>
        </div>
      )}

      {/* Keyframes */}
      <style>{`
        @keyframes eq-bar1 { from { height: 4px; } to { height: 14px; } }
        @keyframes eq-bar2 { from { height: 6px; } to { height: 18px; } }
        @keyframes eq-bar3 { from { height: 4px; } to { height: 12px; } }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-screens

function Loading() {
  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: '#202124' }}>
      <div className="w-10 h-10 rounded-full border-2 border-[#3c4043] border-t-[#8ab4f8] animate-spin" />
    </div>
  );
}

function ErrorScreen({ msg }: { msg: string }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: '#202124', fontFamily: 'Google Sans, sans-serif' }}>
      <div className="text-center space-y-3">
        <p className="text-xl text-white">Sala no encontrada</p>
        <p className="text-sm" style={{ color: '#9aa0a6' }}>{msg}</p>
      </div>
    </div>
  );
}

function FinishedScreen({ info, elapsed, fmt }: { info: SalaInfo | null; elapsed: number; fmt: (s: number) => string }) {
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-8 px-6 text-center"
      style={{ background: '#202124', fontFamily: 'Google Sans, Roboto, sans-serif' }}
    >
      {/* Check circle */}
      <div
        className="w-20 h-20 rounded-full flex items-center justify-center"
        style={{ background: '#1e3a22' }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
          <path d="M5 13l4 4L19 7" stroke="#34a853" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div>
        <h1 className="text-2xl font-semibold text-white mb-2">Entrevista finalizada</h1>
        <p style={{ color: '#9aa0a6' }}>
          Gracias{info?.candidateName ? `, ${info.candidateName}` : ''}.
          El equipo de {info?.company ?? 'la empresa'} estará en contacto pronto.
        </p>
        {elapsed > 0 && (
          <p className="mt-2 text-sm" style={{ color: '#5f6368' }}>
            Duración: {fmt(elapsed)}
          </p>
        )}
      </div>
      {info?.jobTitle && (
        <p className="text-sm" style={{ color: '#5f6368' }}>{info.jobTitle} · {info.company}</p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Control buttons

function CallBtn({
  active, onClick, icon, offIcon, label,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; offIcon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} title={label} className="flex flex-col items-center gap-1">
      <span
        className="w-12 h-12 rounded-full flex items-center justify-center transition-colors"
        style={{ background: active ? '#3c4043' : '#ea4335' }}
      >
        {active ? icon : offIcon}
      </span>
      <span className="text-[11px]" style={{ color: '#9aa0a6' }}>{label}</span>
    </button>
  );
}

function LobbyToggle({
  active, onClick, icon, offIcon, label,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; offIcon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-white text-xs"
      style={{ background: active ? 'rgba(255,255,255,0.15)' : 'rgba(234,67,53,0.8)' }}
    >
      <span className="w-4 h-4">{active ? icon : offIcon}</span>
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG icons (Google Meet style)

function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
      <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 7v2h2v2h-4v-2h2v-2a7 7 0 01-7-7h2a5 5 0 0010 0h2a7 7 0 01-7 7z" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
      <path d="M19 11a7 7 0 01-1.16 3.81L16.42 13.4A5 5 0 0017 11h2zM12 5a3 3 0 013 3v.17l-6-6A3 3 0 0112 2V5zm0 9a3 3 0 01-3-3V5.83L3.27 3.1 2 4.37l7 7V11a5 5 0 005 5v2h2v-2a7 7 0 004.43-2.69l-1.43-1.43A5 5 0 0112 17v-3zM3 13h2a7 7 0 001.46 4.33L4.27 18.6A9 9 0 013 13zm11.41 5.17L12.59 16.4A3 3 0 019 13v-.41L7 10.59V13a5 5 0 007.41 4.41zM4.27 3L3 4.27l.73.73L19 20.27 20.27 19 4.27 3z" />
    </svg>
  );
}

function CamIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
      <path d="M15 8v8H5V8h10m1-2H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4V7a1 1 0 00-1-1z" />
    </svg>
  );
}

function CamOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
      <path d="M21 6.5l-4 4V7a1 1 0 00-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27l4.01 4.01A1 1 0 006 8v10a1 1 0 001 1h10c.35 0 .65-.19.84-.46L19.73 21 21 19.73 3.27 2zm9.55 13H7V9.27l5.82 5.82V15z" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="white" style={{ transform: 'rotate(135deg)' }}>
      <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
    </svg>
  );
}
