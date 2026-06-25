'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useVoice } from '@/lib/useVoice';

const WS_URL  = process.env.NEXT_PUBLIC_WS_URL  ?? 'ws://localhost:4000';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

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

  // leIA video refs
  const idleRef = useRef<HTMLVideoElement>(null);
  const talkRef = useRef<HTMLVideoElement>(null);

  // Candidate self-view
  const selfRef = useRef<HTMLVideoElement>(null);

  // UI state
  const [leiaSpeaking,  setLeiaSpeaking]  = useState(false);
  const [leiaThinking,  setLeiaThinking]  = useState(false);
  const [subtitle,      setSubtitle]      = useState('');
  const [showCC,        setShowCC]        = useState(true);
  const [micOn,         setMicOn]         = useState(true);
  const [cameraOn,      setCameraOn]      = useState(true);
  const [elapsed,       setElapsed]       = useState(0);
  const [recording,     setRecording]     = useState(false);

  // Stable refs for reactive values used inside callbacks
  const micOnRef    = useRef(micOn);
  const phaseRef    = useRef(phase);
  useEffect(() => { micOnRef.current   = micOn;  }, [micOn]);
  useEffect(() => { phaseRef.current   = phase;  }, [phase]);

  // Stream & recording
  const streamRef   = useRef<MediaStream | null>(null);
  const lobbyStream = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);

  // WS
  const wsRef = useRef<WebSocket | null>(null);

  // Timer
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // AudioContext — created on user gesture to unlock autoplay
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Audio queue (processed sequentially via AudioContext)
  const audioQueueRef = useRef<Array<{ mimeType: string; audioBase64: string }>>([]);
  const playingRef    = useRef(false);

  // ── Voice recognition ──────────────────────────────────────────────────────
  const startListeningRef = useRef<() => void>(() => {});
  const stopListeningRef  = useRef<() => void>(() => {});
  const resetFinalRef     = useRef<() => void>(() => {});

  const { listening, interimText, startListening, stopListening, resetFinal } = useVoice({
    silenceMs: 2000,
    onSilence: (text) => {
      if (!text.trim() || phaseRef.current !== 'running') return;
      wsRef.current?.send(JSON.stringify({ type: 'transcript', text, isFinal: true }));
      resetFinalRef.current();
    },
  });

  useEffect(() => { startListeningRef.current = startListening; }, [startListening]);
  useEffect(() => { stopListeningRef.current  = stopListening;  }, [stopListening]);
  useEffect(() => { resetFinalRef.current     = resetFinal;     }, [resetFinal]);

  // ── Load sala info ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_URL}/api/sala/${id}/info`)
      .then(r => { if (!r.ok) throw new Error('sala_no_encontrada'); return r.json(); })
      .then((d: SalaInfo) => { setInfo(d); setPhase('lobby'); })
      .catch(e => { setErrMsg(e?.message ?? 'Error'); setPhase('error'); });
  }, [id]);

  // ── Sync camera stream → video element ────────────────────────────────────
  useEffect(() => {
    if (selfRef.current && streamRef.current) {
      selfRef.current.srcObject = streamRef.current;
    }
  }, [phase]);

  // ── Lobby camera preview ───────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'lobby') return;
    let alive = true;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(s => {
        if (!alive) { s.getTracks().forEach(t => t.stop()); return; }
        lobbyStream.current = s;
        if (selfRef.current) selfRef.current.srcObject = s;
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [phase]);

  // ── Audio playback via AudioContext ───────────────────────────────────────
  const playNext = useCallback(() => {
    const queue = audioQueueRef.current;
    const ctx   = audioCtxRef.current;

    if (!queue.length || !ctx) {
      playingRef.current = false;
      setLeiaSpeaking(false);
      // switch back to idle video
      if (idleRef.current) { idleRef.current.style.display = 'block'; idleRef.current.play().catch(() => {}); }
      if (talkRef.current) { talkRef.current.style.display = 'none';  talkRef.current.pause(); }
      if (micOnRef.current) startListeningRef.current();
      return;
    }

    const item = queue.shift()!;
    playingRef.current = true;
    setLeiaSpeaking(true);
    setLeiaThinking(false);
    stopListeningRef.current();

    // Switch to talking video
    if (idleRef.current) { idleRef.current.style.display = 'none';  idleRef.current.pause(); }
    if (talkRef.current) { talkRef.current.style.display = 'block'; talkRef.current.currentTime = 0; talkRef.current.play().catch(() => {}); }

    // Decode base64 → ArrayBuffer
    let arrayBuffer: ArrayBuffer;
    try {
      const bytes = atob(item.audioBase64);
      const arr   = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      arrayBuffer = arr.buffer;
    } catch {
      setTimeout(playNext, 20);
      return;
    }

    // Decode & play via AudioContext
    ctx.decodeAudioData(
      arrayBuffer,
      (buffer) => {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = () => setTimeout(playNext, 40);
        source.start(0);
      },
      () => setTimeout(playNext, 20), // decode error → try next
    );
  }, []); // stable — reads everything from refs

  const enqueueAudio = useCallback((mimeType: string, audioBase64: string) => {
    audioQueueRef.current.push({ mimeType, audioBase64 });
    setLeiaThinking(false);
    if (!playingRef.current) playNext();
  }, [playNext]);

  // Stable ref so ws.onmessage never goes stale
  const enqueueRef = useRef(enqueueAudio);
  useEffect(() => { enqueueRef.current = enqueueAudio; }, [enqueueAudio]);

  // ── Join call ──────────────────────────────────────────────────────────────
  const joinCall = useCallback(async () => {
    // Stop lobby preview
    lobbyStream.current?.getTracks().forEach(t => t.stop());
    lobbyStream.current = null;

    // *** Unlock AudioContext on this user gesture ***
    const ctx = new (window.AudioContext ?? (window as any).webkitAudioContext)() as AudioContext;
    if (ctx.state === 'suspended') await ctx.resume();
    audioCtxRef.current = ctx;

    setPhase('running');
    phaseRef.current = 'running';

    // Get camera + mic
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      stream.getVideoTracks().forEach(t => (t.enabled = cameraOn));
      stream.getAudioTracks().forEach(t => (t.enabled  = micOn));
      // Assign to video element (may be mounted by now or via useEffect above)
      if (selfRef.current) selfRef.current.srcObject = stream;

      // Recording
      try {
        const mr = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus' });
        mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        mr.start(5000);
        recorderRef.current = mr;
        setRecording(true);
      } catch { /* recording optional */ }
    } catch { /* camera/mic optional */ }

    // Preload talk video
    talkRef.current?.load();

    // Timer
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);

    // WebSocket
    const ws = new WebSocket(`${WS_URL}/ws/sala/${id}`);
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'ready' }));
      setLeiaThinking(true);
    };
    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === 'audio')    enqueueRef.current(msg.mimeType, msg.audioBase64);
        if (msg.type === 'question') setSubtitle(msg.text ?? '');
        if (msg.type === 'status' && msg.status === 'en_curso') setLeiaThinking(true);
        if (msg.type === 'finished') endCall();
      } catch { /* noop */ }
    };
    ws.onclose = () => {};

    const ka = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, 25000);
    ws.onclose = () => clearInterval(ka);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, cameraOn, micOn]);

  // ── End call ───────────────────────────────────────────────────────────────
  const endCall = useCallback(async () => {
    setPhase('finished');
    phaseRef.current = 'finished';
    stopListeningRef.current();
    if (timerRef.current) clearInterval(timerRef.current);
    audioCtxRef.current?.close().catch(() => {});

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
    setRecording(false);
    streamRef.current?.getTracks().forEach(t => t.stop());
    wsRef.current?.close();
  }, [id]);

  // ── Mic / camera toggles ───────────────────────────────────────────────────
  const toggleMic = useCallback(() => {
    const next = !micOnRef.current;
    setMicOn(next);
    micOnRef.current = next;
    streamRef.current?.getAudioTracks().forEach(t => (t.enabled = next));
    if (!next) stopListeningRef.current();
  }, []);

  const toggleCam = useCallback(() => {
    const next = !cameraOn;
    setCameraOn(next);
    streamRef.current?.getVideoTracks().forEach(t => (t.enabled = next));
  }, [cameraOn]);

  const toggleRec = useCallback(() => {
    const mr = recorderRef.current;
    if (!mr) return;
    if (mr.state === 'recording') { mr.pause(); setRecording(false); }
    else { mr.resume(); setRecording(true); }
  }, []);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    wsRef.current?.close();
    streamRef.current?.getTracks().forEach(t => t.stop());
    lobbyStream.current?.getTracks().forEach(t => t.stop());
    audioCtxRef.current?.close().catch(() => {});
  }, []);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const meetCode = id.slice(0, 3) + '-' + id.slice(3, 7) + '-' + id.slice(7, 10);

  // ── Phase routing ──────────────────────────────────────────────────────────
  if (phase === 'loading')  return <Loading />;
  if (phase === 'error')    return <ErrorScreen msg={errMsg} />;
  if (phase === 'finished') return <FinishedScreen info={info} elapsed={elapsed} fmt={fmt} />;

  // ── Shared video elements (mounted in ALL phases so refs are stable) ───────
  const sharedVideos = (
    <>
      {/* leIA videos — only visible in running phase */}
      <video ref={idleRef} autoPlay loop muted playsInline
        style={{ display: phase === 'running' ? 'block' : 'none', position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}>
        <source src={`${API_URL}/bot-stage-video/idle`} type="video/mp4" />
      </video>
      <video ref={talkRef} loop muted playsInline
        style={{ display: 'none', position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}>
        <source src={`${API_URL}/bot-stage-video/talk`} type="video/mp4" />
      </video>
    </>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // LOBBY
  // ═══════════════════════════════════════════════════════════════════════════
  if (phase === 'lobby') {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#000', fontFamily: 'Google Sans, Roboto, Arial, sans-serif', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 24, padding: 16 }}>
        {/* Company / job */}
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#8ab4f8', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{info?.company}</p>
          <h1 style={{ fontSize: 22, fontWeight: 400, margin: 0 }}>{info?.jobTitle ?? 'Entrevista'}</h1>
          {info?.candidateName && <p style={{ color: '#9aa0a6', fontSize: 13, marginTop: 4 }}>Hola, {info.candidateName}</p>}
        </div>

        {/* Camera preview */}
        <div style={{ position: 'relative', width: 'min(480px, calc(100vw - 32px))', aspectRatio: '4/3', borderRadius: 12, overflow: 'hidden', background: '#1c1c1c' }}>
          <video ref={selfRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: 'block' }} />
          {/* name badge inside preview */}
          <div style={{ position: 'absolute', bottom: 12, left: 12, background: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: '3px 10px', fontSize: 13 }}>
            {info?.candidateName ?? 'Tú'}
          </div>
          {/* lobby mic/cam toggles */}
          <div style={{ position: 'absolute', bottom: 12, right: 12, display: 'flex', gap: 8 }}>
            <LobbyIconBtn active={micOn}    onClick={() => { setMicOn(v => !v); }} icon={micOn ? <MicSVG /> : <MicOffSVG />}    bg={micOn ? 'rgba(255,255,255,0.15)' : '#ea4335'} />
            <LobbyIconBtn active={cameraOn} onClick={() => { setCameraOn(v => !v); }} icon={cameraOn ? <CamSVG /> : <CamOffSVG />} bg={cameraOn ? 'rgba(255,255,255,0.15)' : '#ea4335'} />
          </div>
        </div>

        {/* Join button */}
        <button onClick={joinCall}
          style={{ background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 24, padding: '12px 40px', fontSize: 15, fontWeight: 500, cursor: 'pointer', minWidth: 200, fontFamily: 'inherit' }}>
          Unirse ahora
        </button>
        <p style={{ color: '#5f6368', fontSize: 12, textAlign: 'center', maxWidth: 300, margin: 0 }}>
          leIA conducirá la entrevista. Hablá en voz alta para responder cada pregunta.
        </p>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RUNNING — Google Meet style
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', fontFamily: 'Google Sans, Roboto, Arial, sans-serif', color: '#fff', overflow: 'hidden' }}>

      {/* ── Top bar (floating text, like Meet) ───────────────────────────── */}
      <div style={{ position: 'absolute', top: 0, inset: '0 0 auto 0', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', zIndex: 20, pointerEvents: 'none' }}>
        <span style={{ fontSize: 13, color: '#9aa0a6' }}>
          {fmt(elapsed)} · {meetCode}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'auto' }}>
          {recording && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: '3px 10px' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ea4335', display: 'inline-block', animation: 'blink 1.4s step-start infinite' }} />
              <span style={{ fontSize: 12 }}>REC</span>
            </div>
          )}
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#3c4043', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
            1
          </div>
        </div>
      </div>

      {/* ── Main tile (leIA) ─────────────────────────────────────────────── */}
      <div style={{ position: 'absolute', inset: '52px 0 72px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 8px 8px 8px' }}>
        {/* Tile wrapper: 16:9, fits in viewport */}
        <div style={{
          position: 'relative',
          width:  'min(calc((100vh - 132px) * 16 / 9), calc(100vw - 16px))',
          height: 'min(calc(100vw / 16 * 9), calc(100vh - 132px))',
          borderRadius: 12,
          overflow: 'hidden',
          background: '#1c1c1c',
          outline: leiaSpeaking ? '3px solid #1a73e8' : '1px solid rgba(255,255,255,0.1)',
          transition: 'outline-color 0.15s',
        }}>
          {/* leIA video (idle / talk) */}
          {sharedVideos}

          {/* Thinking dots */}
          {leiaThinking && !leiaSpeaking && (
            <div style={{ position: 'absolute', bottom: 14, left: 14, display: 'flex', gap: 5, background: 'rgba(0,0,0,0.55)', borderRadius: 20, padding: '5px 12px' }}>
              {[0,150,300].map(d => (
                <span key={d} style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', display: 'inline-block', animation: `bounce 1s ${d}ms ease-in-out infinite` }} />
              ))}
            </div>
          )}

          {/* Sound bars when speaking */}
          {leiaSpeaking && (
            <div style={{ position: 'absolute', bottom: 14, left: 14, display: 'flex', alignItems: 'flex-end', gap: 3, height: 18 }}>
              {[0,1,2,3].map(i => (
                <span key={i} style={{ width: 3, borderRadius: 3, background: '#fff', opacity: 0.85, display: 'inline-block', animation: `eq ${0.5 + i * 0.08}s ease-in-out ${i * 60}ms infinite alternate` }} />
              ))}
            </div>
          )}

          {/* Name badge */}
          <div style={{ position: 'absolute', bottom: 14, left: leiaSpeaking ? 36 : 14, transition: 'left 0.15s', background: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: '3px 10px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: leiaSpeaking ? '#1a73e8' : 'transparent', border: '1.5px solid rgba(255,255,255,0.4)', display: 'inline-block', flexShrink: 0 }} />
            leIA
          </div>
        </div>
      </div>

      {/* ── Self-cam PiP (bottom-right, above controls) ───────────────────── */}
      <div style={{
        position: 'absolute',
        bottom: 84,
        right: 12,
        width: 180,
        height: 101,
        borderRadius: 8,
        overflow: 'hidden',
        background: '#1c1c1c',
        outline: listening ? '2px solid #34a853' : '1px solid rgba(255,255,255,0.15)',
        transition: 'outline-color 0.15s',
        zIndex: 10,
        cursor: 'default',
      }}>
        {cameraOn ? (
          <video ref={selfRef} autoPlay playsInline muted
            style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>
            {(info?.candidateName ?? 'T')[0].toUpperCase()}
          </div>
        )}
        <div style={{ position: 'absolute', bottom: 5, left: 8, fontSize: 11, background: 'rgba(0,0,0,0.6)', borderRadius: 3, padding: '1px 6px' }}>
          {info?.candidateName ?? 'Tú'} (tú)
        </div>
        {!micOn && (
          <div style={{ position: 'absolute', top: 5, right: 6 }}>
            <MicOffSVG size={14} />
          </div>
        )}
      </div>

      {/* ── Subtitles / captions ─────────────────────────────────────────── */}
      {showCC && subtitle && (
        <div style={{ position: 'absolute', bottom: 84, left: 0, right: 200, display: 'flex', justifyContent: 'center', zIndex: 10, pointerEvents: 'none', padding: '0 12px' }}>
          <div style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', borderRadius: 8, padding: '8px 18px', fontSize: 15, lineHeight: 1.5, maxWidth: 560, textAlign: 'center' }}>
            {subtitle}
          </div>
        </div>
      )}

      {/* Interim transcript */}
      {showCC && interimText && (
        <div style={{ position: 'absolute', bottom: subtitle ? 138 : 84, inset: '0 200px 0 0', display: 'flex', justifyContent: 'center', alignItems: 'flex-end', zIndex: 10, pointerEvents: 'none' }}>
          <span style={{ fontSize: 13, color: '#9aa0a6', fontStyle: 'italic' }}>{interimText}</span>
        </div>
      )}

      {/* ── Bottom control bar (Meet style: floating, centered) ──────────── */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        inset: 'auto 0 0 0',
        height: 72,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        zIndex: 30,
      }}>

        {/* Left group */}
        <div style={{ display: 'flex', gap: 6, marginRight: 4 }}>
          {/* CC toggle */}
          <MeetBtn
            onClick={() => setShowCC(v => !v)}
            label="Subtítulos"
            active={showCC}
            activeColor="#1a73e8"
            icon={<CCSVG />}
          />
          {/* Record toggle */}
          <MeetBtn
            onClick={toggleRec}
            label={recording ? 'Detener' : 'Grabar'}
            active={recording}
            activeColor="#ea4335"
            icon={<RecSVG recording={recording} />}
          />
        </div>

        {/* Center group */}
        <div style={{ display: 'flex', gap: 6 }}>
          <MeetBtn onClick={toggleMic}  label={micOn    ? 'Silenciar'  : 'Activar mic'} active={micOn}    icon={micOn    ? <MicSVG /> : <MicOffSVG />}    inactiveRed />
          <MeetBtn onClick={toggleCam}  label={cameraOn ? 'Cámara'     : 'Sin cámara'}  active={cameraOn} icon={cameraOn ? <CamSVG /> : <CamOffSVG />}    inactiveRed />
        </div>

        {/* Hang up — separated */}
        <div style={{ marginLeft: 4 }}>
          <button onClick={endCall}
            style={{ width: 52, height: 52, borderRadius: '50%', background: '#ea4335', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title="Salir de la entrevista"
          >
            <PhoneSVG />
          </button>
        </div>
      </div>

      {/* ── Keyframes ────────────────────────────────────────────────────── */}
      <style>{`
        @keyframes blink  { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
        @keyframes eq     { from{height:4px} to{height:16px} }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-screens

function Loading() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid #3c4043', borderTopColor: '#8ab4f8', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function ErrorScreen({ msg }: { msg: string }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Google Sans, sans-serif', color: '#fff' }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 18, marginBottom: 8 }}>Sala no encontrada</p>
        <p style={{ fontSize: 13, color: '#9aa0a6' }}>{msg}</p>
      </div>
    </div>
  );
}

function FinishedScreen({ info, elapsed, fmt }: { info: SalaInfo | null; elapsed: number; fmt: (s: number) => string }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, fontFamily: 'Google Sans, Roboto, sans-serif', color: '#fff', padding: 24 }}>
      <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#1e3a22', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#34a853" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 22, fontWeight: 400, margin: '0 0 8px' }}>Entrevista finalizada</h1>
        <p style={{ color: '#9aa0a6', margin: 0 }}>Gracias{info?.candidateName ? `, ${info.candidateName}` : ''}. El equipo de {info?.company ?? 'la empresa'} estará en contacto pronto.</p>
        {elapsed > 0 && <p style={{ color: '#5f6368', fontSize: 13, marginTop: 8 }}>Duración: {fmt(elapsed)}</p>}
      </div>
      {info?.jobTitle && <p style={{ color: '#5f6368', fontSize: 13 }}>{info.jobTitle} · {info.company}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Control button components

function MeetBtn({ onClick, label, active, icon, activeColor = '#3c4043', inactiveRed }: {
  onClick: () => void; label: string; active: boolean; icon: React.ReactNode;
  activeColor?: string; inactiveRed?: boolean;
}) {
  return (
    <button onClick={onClick} title={label}
      style={{ background: active ? '#3c4043' : (inactiveRed ? '#ea4335' : '#3c4043'), border: 'none', borderRadius: '50%', width: 48, height: 48, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', outline: active && activeColor !== '#3c4043' ? `2px solid ${activeColor}` : 'none', transition: 'background 0.1s', flexShrink: 0 }}>
      {icon}
    </button>
  );
}

function LobbyIconBtn({ active, onClick, icon, bg }: { active: boolean; onClick: () => void; icon: React.ReactNode; bg: string }) {
  return (
    <button onClick={onClick} style={{ background: bg, border: 'none', borderRadius: '50%', width: 38, height: 38, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.1s' }}>
      {icon}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG icons

function MicSVG({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="white"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 7v2h2v2h-4v-2h2v-2a7 7 0 01-7-7h2a5 5 0 0010 0h2a7 7 0 01-7 7z"/></svg>;
}
function MicOffSVG({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="white"><path d="M19 11a7 7 0 01-1.16 3.81L16.42 13.4A5 5 0 0017 11h2zM12 5a3 3 0 013 3v.17l-6-6A3 3 0 0112 2V5zm0 9a3 3 0 01-3-3V5.83L3.27 3.1 2 4.37l7 7V11a5 5 0 005 5v2h2v-2a7 7 0 004.43-2.69l-1.43-1.43A5 5 0 0112 17v-3zM3 13h2a7 7 0 001.46 4.33L4.27 18.6A9 9 0 013 13zM4.27 3L3 4.27l.73.73L19 20.27 20.27 19 4.27 3z"/></svg>;
}
function CamSVG({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="white"><path d="M15 8v8H5V8h10m1-2H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4V7a1 1 0 00-1-1z"/></svg>;
}
function CamOffSVG({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="white"><path d="M21 6.5l-4 4V7a1 1 0 00-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27l4.01 4.01A1 1 0 006 8v10a1 1 0 001 1h10c.35 0 .65-.19.84-.46L19.73 21 21 19.73 3.27 2zm9.55 13H7V9.27l5.82 5.82V15z"/></svg>;
}
function PhoneSVG() {
  return <svg width={22} height={22} viewBox="0 0 24 24" fill="white" style={{ transform: 'rotate(135deg)' }}><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>;
}
function CCSVG() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="white"><path d="M19 4H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm-8 9H9.5v-.5h-2v3h2V15H11v1a2 2 0 01-2 2H7a2 2 0 01-2-2v-4a2 2 0 012-2h2a2 2 0 012 2v1zm7 0h-1.5v-.5h-2v3h2V15H18v1a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4a2 2 0 012-2h2a2 2 0 012 2v1z"/></svg>;
}
function RecSVG({ recording }: { recording: boolean }) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="white">
      {recording
        ? <rect x="6" y="6" width="12" height="12" rx="2" fill="white" />
        : <circle cx="12" cy="12" r="6" fill="white" />
      }
    </svg>
  );
}
