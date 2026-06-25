'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useVoice } from '@/lib/useVoice';

const WS_URL  = process.env.NEXT_PUBLIC_WS_URL  ?? 'ws://localhost:4000';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface SalaInfo {
  interviewId: string;
  status:       string;
  jobTitle:     string;
  company:      string;
  candidateName: string;
}

type Phase = 'loading' | 'lobby' | 'running' | 'finished' | 'error';

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  return types.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
}

// ─────────────────────────────────────────────────────────────────────────────
export default function SalaPage() {
  const { id } = useParams<{ id: string }>();

  const [info,   setInfo]   = useState<SalaInfo | null>(null);
  const [phase,  setPhase]  = useState<Phase>('loading');
  const [errMsg, setErrMsg] = useState('');

  // leIA video refs (always mounted during running)
  const idleRef = useRef<HTMLVideoElement>(null);
  const talkRef = useRef<HTMLVideoElement>(null);

  // Self-cam: lobby preview (unmounts) and running PiP (always mounted in running)
  const lobbyVideoRef = useRef<HTMLVideoElement>(null);
  const pipRef        = useRef<HTMLVideoElement>(null);

  // Stream state — useEffect syncs it to whichever video is active
  const [currentStream, setCurrentStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lobbyStream = useRef<MediaStream | null>(null);

  // UI state
  const [leiaSpeaking, setLeiaSpeaking] = useState(false);
  const [leiaThinking, setLeiaThinking] = useState(false);
  const [subtitle,     setSubtitle]     = useState('');
  const [showCC,       setShowCC]       = useState(true);
  const [micOn,        setMicOn]        = useState(true);
  const [cameraOn,     setCameraOn]     = useState(true);
  const [elapsed,      setElapsed]      = useState(0);
  const [recording,    setRecording]    = useState(false);

  // Stable refs
  const micOnRef    = useRef(micOn);
  const phaseRef    = useRef(phase);
  const cameraOnRef = useRef(cameraOn);
  useEffect(() => { micOnRef.current    = micOn;    }, [micOn]);
  useEffect(() => { phaseRef.current    = phase;    }, [phase]);
  useEffect(() => { cameraOnRef.current = cameraOn; }, [cameraOn]);

  // Recording — composite canvas (leIA + PiP) + audio mix
  const recorderRef      = useRef<MediaRecorder | null>(null);
  const chunksRef        = useRef<Blob[]>([]);
  const mimeTypeRef      = useRef('');
  const canvasRef        = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef     = useRef<number>(0);
  const leiaSpeakingRef  = useRef(false); // stable ref para el loop de canvas

  // WS / timer
  const wsRef    = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // AudioContext — created on user gesture to unlock autoplay
  const audioCtxRef     = useRef<AudioContext | null>(null);
  const masterGainRef   = useRef<GainNode | null>(null);
  const leiaAudioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  // Audio queue
  const audioQueueRef = useRef<Array<{ mimeType: string; audioBase64: string }>>([]);
  const playingRef    = useRef(false);

  // ── Sync stream to active video element ───────────────────────────────────
  useEffect(() => {
    if (phase === 'lobby' && lobbyVideoRef.current) {
      lobbyVideoRef.current.srcObject = currentStream;
    }
    if (phase === 'running' && pipRef.current) {
      pipRef.current.srcObject = currentStream;
    }
  }, [currentStream, phase]);

  // ── Voice recognition ─────────────────────────────────────────────────────
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

  // ── Lobby camera preview ──────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'lobby') return;
    let alive = true;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(s => {
        if (!alive) { s.getTracks().forEach(t => t.stop()); return; }
        lobbyStream.current = s;
        setCurrentStream(s);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [phase]);

  // ── Audio playback via AudioContext ───────────────────────────────────────
  const playNext = useCallback(() => {
    const queue = audioQueueRef.current;
    const ctx   = audioCtxRef.current;

    if (!queue.length || !ctx) {
      playingRef.current    = false;
      leiaSpeakingRef.current = false;
      setLeiaSpeaking(false);
      if (idleRef.current) { idleRef.current.style.display = 'block'; idleRef.current.play().catch(() => {}); }
      if (talkRef.current) { talkRef.current.style.display = 'none';  talkRef.current.pause(); }
      if (micOnRef.current) startListeningRef.current();
      return;
    }

    const item = queue.shift()!;
    playingRef.current      = true;
    leiaSpeakingRef.current = true;
    setLeiaSpeaking(true);
    setLeiaThinking(false);
    stopListeningRef.current();

    if (idleRef.current) { idleRef.current.style.display = 'none';  idleRef.current.pause(); }
    if (talkRef.current) { talkRef.current.style.display = 'block'; talkRef.current.currentTime = 0; talkRef.current.play().catch(() => {}); }

    let arrayBuffer: ArrayBuffer;
    try {
      const bytes = atob(item.audioBase64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      arrayBuffer = arr.buffer;
    } catch {
      setTimeout(playNext, 20);
      return;
    }

    ctx.decodeAudioData(
      arrayBuffer,
      (buffer) => {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        // Rutar por masterGain → speaker + (si graba) destino de grabación
        source.connect(masterGainRef.current ?? ctx.destination);
        source.onended = () => setTimeout(playNext, 40);
        source.start(0);
      },
      () => setTimeout(playNext, 20),
    );
  }, []);

  const enqueueAudio = useCallback((mimeType: string, audioBase64: string) => {
    audioQueueRef.current.push({ mimeType, audioBase64 });
    setLeiaThinking(false);
    if (!playingRef.current) playNext();
  }, [playNext]);

  const enqueueRef = useRef(enqueueAudio);
  useEffect(() => { enqueueRef.current = enqueueAudio; }, [enqueueAudio]);

  // ── Join call ─────────────────────────────────────────────────────────────
  const joinCall = useCallback(async () => {
    lobbyStream.current?.getTracks().forEach(t => t.stop());
    lobbyStream.current = null;

    // Unlock AudioContext en el gesto del usuario + crear masterGain
    const ctx = new (window.AudioContext ?? (window as any).webkitAudioContext)() as AudioContext;
    if (ctx.state === 'suspended') await ctx.resume();
    audioCtxRef.current = ctx;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    masterGainRef.current = gain;

    setPhase('running');
    phaseRef.current = 'running';

    // Get camera + mic
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      stream.getVideoTracks().forEach(t => (t.enabled = cameraOnRef.current));
      stream.getAudioTracks().forEach(t => (t.enabled  = micOnRef.current));
      setCurrentStream(stream);
    } catch { /* camera/mic optional */ }

    // Preload talk video
    talkRef.current?.load();

    // Timer
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);

    // WebSocket
    const ws = new WebSocket(`${WS_URL}/ws/sala/${id}`);
    wsRef.current = ws;
    ws.onopen = () => { ws.send(JSON.stringify({ type: 'ready' })); setLeiaThinking(true); };
    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === 'audio')    enqueueRef.current(msg.mimeType, msg.audioBase64);
        if (msg.type === 'question') setSubtitle(msg.text ?? '');
        if (msg.type === 'status' && msg.status === 'en_curso') setLeiaThinking(true);
        if (msg.type === 'finished') endCall();
      } catch { /* noop */ }
    };
    const ka = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, 25000);
    ws.onclose = () => clearInterval(ka);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ── Recording: canvas compuesto (leIA + PiP) + audio mixeado ─────────────
  const startRecording = useCallback(() => {
    if (recorderRef.current) return; // ya grabando

    const mime = getSupportedMimeType();
    if (!mime) return;
    mimeTypeRef.current = mime;
    chunksRef.current   = [];

    // Canvas 1280×720 que compone leIA + PiP del candidato
    const canvas = document.createElement('canvas');
    canvas.width  = 1280;
    canvas.height = 720;
    const ctx2d = canvas.getContext('2d')!;
    canvasRef.current = canvas;

    const drawFrame = () => {
      // Fondo negro
      ctx2d.fillStyle = '#111';
      ctx2d.fillRect(0, 0, 1280, 720);

      // Video de leIA (idle o talk según estado)
      const leiaVid = leiaSpeakingRef.current ? talkRef.current : idleRef.current;
      if (leiaVid && leiaVid.readyState >= 2) {
        try { ctx2d.drawImage(leiaVid, 0, 0, 1280, 720); } catch { /* noop */ }
      }

      // PiP del candidato (bottom-right, 202×114)
      if (pipRef.current && pipRef.current.readyState >= 2) {
        const pw = 202, ph = 114, m = 12;
        ctx2d.save();
        ctx2d.translate(1280 - m - pw / 2, 720 - m - ph / 2); // center of PiP
        ctx2d.scale(-1, 1);                                     // mirror candidate
        ctx2d.drawImage(pipRef.current, -pw / 2, -ph / 2, pw, ph);
        ctx2d.restore();
        // borde blanco
        ctx2d.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx2d.lineWidth   = 1;
        ctx2d.strokeRect(1280 - m - pw, 720 - m - ph, pw, ph);
      }

      animFrameRef.current = requestAnimationFrame(drawFrame);
    };
    drawFrame();

    // Stream del canvas a 25 fps
    const canvasStream = canvas.captureStream(25);

    // Audio: leIA TTS (AudioContext) + micrófono del candidato
    const audioCtx = audioCtxRef.current;
    const master   = masterGainRef.current;
    if (audioCtx && master) {
      const leiaDest = audioCtx.createMediaStreamDestination();
      master.connect(leiaDest);
      leiaAudioDestRef.current = leiaDest;
      // leIA TTS → grabación
      leiaDest.stream.getAudioTracks().forEach(t => canvasStream.addTrack(t));
      // Micrófono → grabación (NO al speaker, evita eco)
      if (streamRef.current) {
        const micSrc  = audioCtx.createMediaStreamSource(streamRef.current);
        const micGain = audioCtx.createGain();
        micSrc.connect(micGain);
        micGain.connect(leiaDest);
      }
    }

    try {
      const mr = new MediaRecorder(canvasStream, { mimeType: mime });
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(3000);
      recorderRef.current = mr;
      setRecording(true);
    } catch {
      cancelAnimationFrame(animFrameRef.current);
      canvasRef.current = null;
    }
  }, []);

  const stopRecording = useCallback(async (download = true) => {
    cancelAnimationFrame(animFrameRef.current);
    canvasRef.current = null;

    const mr = recorderRef.current;
    recorderRef.current = null;
    setRecording(false);

    if (mr && mr.state !== 'inactive') {
      mr.stop();
      await new Promise<void>(res => { mr.onstop = () => res(); });
    }

    // Desconectar leIA audio del destino de grabación
    if (leiaAudioDestRef.current && masterGainRef.current) {
      try { masterGainRef.current.disconnect(leiaAudioDestRef.current); } catch { /* noop */ }
      leiaAudioDestRef.current = null;
    }

    if (!download) return;
    const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'video/webm' });
    if (blob.size < 5000) return;

    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    const ext  = mimeTypeRef.current.includes('mp4') ? 'mp4' : 'webm';
    a.download = `entrevista-${id.slice(0, 8)}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 8000);

    fetch(`${API_URL}/api/sala/${id}/recording`, {
      method: 'POST', headers: { 'Content-Type': blob.type }, body: blob,
    }).catch(() => {});
  }, [id]);

  // ── End call ──────────────────────────────────────────────────────────────
  const endCall = useCallback(async () => {
    if (phaseRef.current === 'finished') return;
    setPhase('finished');
    phaseRef.current = 'finished';
    stopListeningRef.current();
    if (timerRef.current) clearInterval(timerRef.current);
    audioQueueRef.current = [];

    // Si estaba grabando, detener y descargar
    if (recorderRef.current) await stopRecording(true);

    audioCtxRef.current?.close().catch(() => {});
    streamRef.current?.getTracks().forEach(t => t.stop());
    wsRef.current?.close();
  }, [stopRecording]);

  // ── Mic toggle ────────────────────────────────────────────────────────────
  const toggleMic = useCallback(() => {
    const next = !micOnRef.current;
    setMicOn(next);
    micOnRef.current = next;
    streamRef.current?.getAudioTracks().forEach(t => (t.enabled = next));
    if (!next) {
      stopListeningRef.current();
    } else if (phaseRef.current === 'running' && !playingRef.current) {
      startListeningRef.current();
    }
  }, []);

  // ── Camera toggle ─────────────────────────────────────────────────────────
  const toggleCam = useCallback(() => {
    const next = !cameraOnRef.current;
    setCameraOn(next);
    cameraOnRef.current = next;
    streamRef.current?.getVideoTracks().forEach(t => (t.enabled = next));
  }, []);

  // ── Rec toggle ────────────────────────────────────────────────────────────
  const toggleRec = useCallback(() => {
    if (!recorderRef.current) {
      startRecording();
    } else {
      stopRecording(true);
    }
  }, [startRecording, stopRecording]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    wsRef.current?.close();
    streamRef.current?.getTracks().forEach(t => t.stop());
    lobbyStream.current?.getTracks().forEach(t => t.stop());
    audioCtxRef.current?.close().catch(() => {});
  }, []);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const meetCode = id.length >= 10
    ? id.slice(0, 3) + '-' + id.slice(3, 7) + '-' + id.slice(7, 10)
    : id;

  // ── Phase routing ─────────────────────────────────────────────────────────
  if (phase === 'loading')  return <Loading />;
  if (phase === 'error')    return <ErrorScreen msg={errMsg} />;
  if (phase === 'finished') return <FinishedScreen info={info} elapsed={elapsed} fmt={fmt} />;

  // ═══════════════════════════════════════════════════════════════════════════
  // LOBBY
  // ═══════════════════════════════════════════════════════════════════════════
  if (phase === 'lobby') {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#000', fontFamily: 'Google Sans, Roboto, sans-serif', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 24, padding: 16 }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#8ab4f8', fontSize: 13, fontWeight: 500, margin: '0 0 4px' }}>{info?.company}</p>
          <h1 style={{ fontSize: 22, fontWeight: 400, margin: 0 }}>{info?.jobTitle ?? 'Entrevista'}</h1>
          {info?.candidateName && <p style={{ color: '#9aa0a6', fontSize: 13, margin: '4px 0 0' }}>Hola, {info.candidateName}</p>}
        </div>

        {/* Camera preview */}
        <div style={{ position: 'relative', width: 'min(480px, calc(100vw - 32px))', aspectRatio: '4/3', borderRadius: 12, overflow: 'hidden', background: '#1c1c1c' }}>
          <video ref={lobbyVideoRef} autoPlay playsInline muted
            style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: 'block' }} />
          <div style={{ position: 'absolute', bottom: 12, left: 12, background: 'rgba(0,0,0,0.65)', borderRadius: 4, padding: '3px 10px', fontSize: 13 }}>
            {info?.candidateName ?? 'Tú'}
          </div>
          {/* Lobby controls */}
          <div style={{ position: 'absolute', bottom: 12, right: 12, display: 'flex', gap: 8 }}>
            <LobbyBtn onClick={() => setMicOn(v => !v)}
              active={micOn} activeColor="#3c4043" inactiveColor="#ea4335"
              icon={micOn ? <MicSVG size={16}/> : <MicOffSVG size={16}/>} />
            <LobbyBtn onClick={() => setCameraOn(v => !v)}
              active={cameraOn} activeColor="#3c4043" inactiveColor="#ea4335"
              icon={cameraOn ? <CamSVG size={16}/> : <CamOffSVG size={16}/>} />
          </div>
        </div>

        <button onClick={joinCall} style={{ background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 24, padding: '12px 40px', fontSize: 15, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: 0.15 }}>
          Unirse ahora
        </button>
        <p style={{ color: '#5f6368', fontSize: 12, textAlign: 'center', maxWidth: 300, margin: 0 }}>
          leIA conducirá la entrevista. Respondé en voz alta cada pregunta.
        </p>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RUNNING — Google Meet style
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', fontFamily: 'Google Sans, Roboto, sans-serif', color: '#fff', overflow: 'hidden', userSelect: 'none' }}>

      {/* ── Top floating bar ─────────────────────────────────────────────── */}
      <div style={{ position: 'absolute', top: 0, inset: '0 0 auto 0', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', zIndex: 20 }}>
        <span style={{ fontSize: 13, color: '#9aa0a6', letterSpacing: 0.2 }}>
          {fmt(elapsed)}&nbsp;·&nbsp;{meetCode}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {recording && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(234,67,53,0.18)', border: '1px solid rgba(234,67,53,0.4)', borderRadius: 20, padding: '3px 10px' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ea4335', display: 'inline-block', animation: 'pulse 1.4s ease-in-out infinite' }} />
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, color: '#ea4335' }}>REC</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Main tile (leIA) ─────────────────────────────────────────────── */}
      <div style={{ position: 'absolute', inset: '52px 0 72px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}>
        <div style={{
          position: 'relative',
          width:  'min(calc((100vh - 132px) * 16 / 9), calc(100vw - 16px))',
          height: 'min(calc(100vw / 16 * 9), calc(100vh - 132px))',
          borderRadius: 12,
          overflow: 'hidden',
          background: '#1c1c1c',
          boxShadow: leiaSpeaking ? '0 0 0 3px #1a73e8' : '0 0 0 1px rgba(255,255,255,0.08)',
          transition: 'box-shadow 0.15s',
        }}>
          {/* Idle video */}
          <video ref={idleRef} autoPlay loop muted playsInline crossOrigin="anonymous"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}>
            <source src={`${API_URL}/bot-stage-video/idle`} type="video/mp4" />
          </video>
          {/* Talk video */}
          <video ref={talkRef} loop muted playsInline crossOrigin="anonymous"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'none' }}>
            <source src={`${API_URL}/bot-stage-video/talk`} type="video/mp4" />
          </video>

          {/* Thinking dots */}
          {leiaThinking && !leiaSpeaking && (
            <div style={{ position: 'absolute', bottom: 16, left: 16, display: 'flex', gap: 5, alignItems: 'center', background: 'rgba(0,0,0,0.55)', borderRadius: 20, padding: '6px 14px' }}>
              {[0, 150, 300].map(d => (
                <span key={d} style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', display: 'inline-block', animation: `bounce 1s ${d}ms ease-in-out infinite` }} />
              ))}
            </div>
          )}

          {/* Sound bars when speaking */}
          {leiaSpeaking && (
            <div style={{ position: 'absolute', bottom: 18, left: 16, display: 'flex', alignItems: 'flex-end', gap: 3, height: 20 }}>
              {[0, 1, 2, 3].map(i => (
                <span key={i} style={{ width: 3, borderRadius: 3, background: '#1a73e8', opacity: 0.9, display: 'inline-block', animation: `eq ${0.5 + i * 0.07}s ease-in-out ${i * 55}ms infinite alternate` }} />
              ))}
            </div>
          )}

          {/* Name badge */}
          <div style={{ position: 'absolute', bottom: 16, left: leiaSpeaking ? 38 : 16, transition: 'left 0.15s', background: 'rgba(0,0,0,0.65)', borderRadius: 4, padding: '3px 10px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 7 }}>
            {leiaSpeaking && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#1a73e8', display: 'inline-block', flexShrink: 0 }} />}
            leIA
          </div>
        </div>
      </div>

      {/* ── PiP self-cam ─────────────────────────────────────────────────── */}
      <div style={{ position: 'absolute', bottom: 84, right: 12, width: 180, height: 101, borderRadius: 8, overflow: 'hidden', background: '#1c1c1c', boxShadow: listening ? '0 0 0 2px #34a853' : '0 0 0 1px rgba(255,255,255,0.12)', transition: 'box-shadow 0.15s', zIndex: 10 }}>
        {/* Video always mounted so srcObject persists across camera toggles */}
        <video ref={pipRef} autoPlay playsInline muted
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: 'block', visibility: cameraOn ? 'visible' : 'hidden' }} />
        {!cameraOn && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, background: '#1c1c1c' }}>
            {(info?.candidateName ?? 'T')[0].toUpperCase()}
          </div>
        )}
        <div style={{ position: 'absolute', bottom: 5, left: 7, fontSize: 11, background: 'rgba(0,0,0,0.65)', borderRadius: 3, padding: '1px 6px' }}>
          {info?.candidateName ?? 'Tú'} (tú)
        </div>
        {!micOn && (
          <div style={{ position: 'absolute', top: 5, right: 6, background: 'rgba(0,0,0,0.6)', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <MicOffSVG size={12} />
          </div>
        )}
      </div>

      {/* ── Subtitles ─────────────────────────────────────────────────────── */}
      {showCC && subtitle && (
        <div style={{ position: 'absolute', bottom: 84, left: 0, right: 200, display: 'flex', justifyContent: 'center', zIndex: 10, padding: '0 16px', pointerEvents: 'none' }}>
          <div style={{ background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(10px)', borderRadius: 8, padding: '8px 20px', fontSize: 15, lineHeight: 1.55, maxWidth: 560, textAlign: 'center' }}>
            {subtitle}
          </div>
        </div>
      )}
      {showCC && interimText && (
        <div style={{ position: 'absolute', bottom: subtitle ? 142 : 84, inset: '0 200px 0 0', display: 'flex', justifyContent: 'center', alignItems: 'flex-end', zIndex: 10, pointerEvents: 'none', paddingBottom: 2 }}>
          <span style={{ fontSize: 13, color: '#9aa0a6', fontStyle: 'italic' }}>{interimText}</span>
        </div>
      )}

      {/* ── Control bar ──────────────────────────────────────────────────── */}
      <div style={{ position: 'absolute', bottom: 0, inset: 'auto 0 0 0', height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, zIndex: 30, padding: '0 12px' }}>
        {/* Group: CC + REC */}
        <div style={{ display: 'flex', gap: 6, marginRight: 8 }}>
          <CtrlBtn onClick={() => setShowCC(v => !v)} label="Subtítulos" active={showCC} highlight="#1a73e8"
            icon={<CCSVG />} />
          <CtrlBtn onClick={toggleRec} label={recording ? 'Detener grabación' : 'Grabar'}
            active={recording} highlight="#ea4335" icon={<RecSVG recording={recording} />} />
        </div>

        {/* Group: Mic + Cam */}
        <CtrlBtn onClick={toggleMic} label={micOn ? 'Silenciar' : 'Activar micrófono'}
          active={micOn} icon={micOn ? <MicSVG /> : <MicOffSVG />} offRed={!micOn} />
        <CtrlBtn onClick={toggleCam} label={cameraOn ? 'Apagar cámara' : 'Encender cámara'}
          active={cameraOn} icon={cameraOn ? <CamSVG /> : <CamOffSVG />} offRed={!cameraOn} />

        {/* Hang up */}
        <div style={{ marginLeft: 8 }}>
          <button onClick={endCall} title="Finalizar entrevista"
            style={{ width: 54, height: 54, borderRadius: '50%', background: '#ea4335', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.5)', transition: 'transform 0.1s, opacity 0.1s' }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            <HangUpSVG />
          </button>
        </div>
      </div>

      {/* keyframes */}
      <style>{`
        @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:.25} }
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes eq     { from{height:4px} to{height:18px} }
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
      <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#1a3a1f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#34a853" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </div>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 22, fontWeight: 400, margin: '0 0 8px' }}>Entrevista finalizada</h1>
        <p style={{ color: '#9aa0a6', margin: 0 }}>
          Gracias{info?.candidateName ? `, ${info.candidateName}` : ''}. El equipo de {info?.company ?? 'la empresa'} se pondrá en contacto pronto.
        </p>
        {elapsed > 0 && <p style={{ color: '#5f6368', fontSize: 13, marginTop: 8 }}>Duración: {fmt(elapsed)}</p>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Control buttons

function CtrlBtn({ onClick, label, active, icon, highlight = '#3c4043', offRed }: {
  onClick: () => void; label: string; active: boolean; icon: React.ReactNode;
  highlight?: string; offRed?: boolean;
}) {
  const bg = offRed && !active ? '#ea4335' : '#3c4043';
  const outline = active && highlight !== '#3c4043' ? `2px solid ${highlight}` : 'none';
  return (
    <button onClick={onClick} title={label}
      style={{ background: bg, border: 'none', outline, borderRadius: '50%', width: 48, height: 48, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.12s, outline 0.12s', flexShrink: 0 }}
      onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.2)')}
      onMouseLeave={e => (e.currentTarget.style.filter = '')}
    >
      {icon}
    </button>
  );
}

function LobbyBtn({ onClick, active, activeColor, inactiveColor, icon }: {
  onClick: () => void; active: boolean; activeColor: string; inactiveColor: string; icon: React.ReactNode;
}) {
  return (
    <button onClick={onClick} style={{ background: active ? activeColor : inactiveColor, border: 'none', borderRadius: '50%', width: 36, height: 36, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {icon}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG icons — stroke-based, consistent style

function MicSVG({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8"  y1="23" x2="16" y2="23"/>
    </svg>
  );
}

function MicOffSVG({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23"/>
      <path d="M9 9v2a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.95-.6"/>
      <path d="M17 16.95A7 7 0 0 1 5 10v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8"  y1="23" x2="16" y2="23"/>
    </svg>
  );
}

function CamSVG({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7" fill="white" stroke="none"/>
      <rect x="1" y="5" width="15" height="14" rx="2"/>
    </svg>
  );
}

function CamOffSVG({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23"/>
      <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3"/>
      <path d="M11 5H6l2-3h7l2 3h3a2 2 0 0 1 2 2v9"/>
      <line x1="23" y1="7"  x2="16" y2="11"/>
      <line x1="16" y1="13" x2="23" y2="17"/>
    </svg>
  );
}

function HangUpSVG() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="white">
      <path d="M6.6 10.8c1.4 2.8 3.8 5.14 6.59 6.59l2.2-2.2c.28-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" transform="rotate(135 12 12)"/>
    </svg>
  );
}

function CCSVG() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2"/>
      <path d="M9 10.5a2.5 2.5 0 0 0-4 0v3a2.5 2.5 0 0 0 4 0"/>
      <path d="M19 10.5a2.5 2.5 0 0 0-4 0v3a2.5 2.5 0 0 0 4 0"/>
    </svg>
  );
}

function RecSVG({ recording }: { recording: boolean }) {
  return recording ? (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="white">
      <rect x="6" y="6" width="12" height="12" rx="2"/>
    </svg>
  ) : (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
      <circle cx="12" cy="12" r="8"/>
      <circle cx="12" cy="12" r="3.5" fill="white" stroke="none"/>
    </svg>
  );
}
