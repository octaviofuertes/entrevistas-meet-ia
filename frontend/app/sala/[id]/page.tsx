'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { BotAvatar } from '@/components/BotAvatar';
import { CandidateVideo } from '@/components/CandidateVideo';
import { useVoice } from '@/lib/useVoice';
import type { FaceMetrics } from '@/lib/useFaceAnalysis';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface SalaInfo {
  interviewId: string;
  status: string;
  jobTitle: string;
  company: string;
  candidateName: string;
  ttsDriver: string;
}

type Phase = 'loading' | 'waiting' | 'running' | 'finished' | 'error';

export default function SalaPage() {
  const { id } = useParams<{ id: string }>();

  const [info, setInfo] = useState<SalaInfo | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  // Subtítulo (pregunta actual de leIA)
  const [subtitle, setSubtitle] = useState('');

  // Estado de leIA
  const [leiaSpeaking, setLeiaSpeaking] = useState(false);
  const [leiaListening, setLeiaListening] = useState(false);
  const [leiaThinking, setLeiaThinking] = useState(false);

  // Cámara y micrófono del candidato
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);

  // Grabación
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunks = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // WebSocket
  const wsRef = useRef<WebSocket | null>(null);
  const wsReadyRef = useRef(false);

  // Cola de audio para reproducción secuencial
  const audioQueueRef = useRef<Array<{ mimeType: string; audioBase64: string; durationMs: number }>>([]);
  const playingRef = useRef(false);
  const speakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Speech recognition — sólo el lado input (leIA tiene su propio audio por WS)
  const { listening, interimText, finalText, startListening, stopListening, resetFinal } = useVoice({
    silenceMs: 2000,
    onSilence: (text) => {
      if (!text.trim() || phase !== 'running') return;
      wsRef.current?.send(JSON.stringify({ type: 'transcript', text, isFinal: true }));
      resetFinal();
    },
  });

  // Carga info pública de la sala
  useEffect(() => {
    async function loadInfo() {
      try {
        const res = await fetch(`${API_URL}/api/sala/${id}/info`);
        if (!res.ok) throw new Error('sala_no_encontrada');
        const data: SalaInfo = await res.json();
        setInfo(data);
        setPhase('waiting');
      } catch (e: any) {
        setErrorMsg(e?.message ?? 'No se pudo cargar la sala');
        setPhase('error');
      }
    }
    loadInfo();
  }, [id]);

  // Iniciar grabación con el stream de la cámara + mic
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      mediaStreamRef.current = stream;
      const mr = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus' });
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.current.push(e.data);
      };
      mr.start(5000); // chunk cada 5 s
      recorderRef.current = mr;
    } catch {
      // Grabación opcional — si no hay permisos se sigue sin grabar
    }
  }, []);

  const stopAndUploadRecording = useCallback(async () => {
    const mr = recorderRef.current;
    if (!mr || mr.state === 'inactive') return;
    mr.stop();
    await new Promise<void>((resolve) => { mr.onstop = () => resolve(); });

    const blob = new Blob(recordedChunks.current, { type: 'video/webm' });
    recordedChunks.current = [];
    if (blob.size < 1000) return; // vacío

    try {
      await fetch(`${API_URL}/api/sala/${id}/recording`, {
        method: 'POST',
        headers: { 'Content-Type': 'video/webm' },
        body: blob,
      });
    } catch { /* ignorar error de upload */ }
  }, [id]);

  // Reproducir siguiente audio de la cola
  const playNext = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      playingRef.current = false;
      setLeiaSpeaking(false);
      setLeiaListening(true);
      if (micOn) startListening();
      return;
    }
    const item = audioQueueRef.current.shift()!;
    playingRef.current = true;
    setLeiaSpeaking(true);
    setLeiaListening(false);
    stopListening();

    const bytes = atob(item.audioBase64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: item.mimeType });
    const url = URL.createObjectURL(blob);

    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => {
      URL.revokeObjectURL(url);
      playNext();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      playNext();
    };
    audio.play().catch(() => playNext());

    // Watchdog por si onended no dispara
    if (speakTimerRef.current) clearTimeout(speakTimerRef.current);
    speakTimerRef.current = setTimeout(() => {
      audio.pause();
      URL.revokeObjectURL(url);
      playNext();
    }, item.durationMs + 2000);
  }, [micOn, startListening, stopListening]);

  const enqueueAudio = useCallback(
    (mimeType: string, audioBase64: string, durationMs: number) => {
      audioQueueRef.current.push({ mimeType, audioBase64, durationMs });
      if (!playingRef.current) {
        setLeiaThinking(false);
        playNext();
      }
    },
    [playNext]
  );

  // Conectar WS cuando el usuario hace click en "Unirse"
  const joinSala = useCallback(async () => {
    setPhase('running');
    await startRecording();

    const ws = new WebSocket(`${WS_URL}/ws/sala/${id}`);
    wsRef.current = ws;

    ws.onopen = () => {
      wsReadyRef.current = true;
      ws.send(JSON.stringify({ type: 'ready' }));
      setLeiaThinking(true);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);

        if (msg.type === 'audio') {
          enqueueAudio(msg.mimeType, msg.audioBase64, msg.durationMs);
        }

        if (msg.type === 'question') {
          setSubtitle(msg.text ?? '');
          setLeiaThinking(false);
        }

        if (msg.type === 'status') {
          if (msg.status === 'en_curso') setLeiaThinking(true);
        }

        if (msg.type === 'talking') {
          setLeiaSpeaking(true);
        }

        if (msg.type === 'finished') {
          setPhase('finished');
          setLeiaSpeaking(false);
          setLeiaListening(false);
          stopListening();
          stopAndUploadRecording();
        }

        if (msg.type === 'pong') { /* keepalive ok */ }
      } catch { /* mensaje malformado */ }
    };

    ws.onclose = () => {
      wsReadyRef.current = false;
      if (phase === 'running') setPhase('finished');
    };

    // Keepalive cada 25 s
    const keepalive = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);

    return () => { clearInterval(keepalive); ws.close(); };
  }, [id, startRecording, enqueueAudio, phase, stopListening, stopAndUploadRecording]);

  // Enviar interim transcripts para mostrar en UI del entrevistador (no bloqueantes)
  useEffect(() => {
    if (!interimText || phase !== 'running') return;
    wsRef.current?.send(JSON.stringify({ type: 'transcript', text: interimText, isFinal: false }));
  }, [interimText, phase]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (speakTimerRef.current) clearTimeout(speakTimerRef.current);
      wsRef.current?.close();
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // --- Render ---

  if (phase === 'error') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white">
        <div className="text-center space-y-4">
          <p className="text-red-400 text-xl">No se pudo cargar la sala</p>
          <p className="text-slate-400 text-sm">{errorMsg}</p>
        </div>
      </div>
    );
  }

  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (phase === 'finished') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white">
        <div className="text-center space-y-6 max-w-md mx-auto px-4">
          <div className="w-24 h-24 mx-auto">
            <BotAvatar />
          </div>
          <h1 className="text-2xl font-semibold">Entrevista finalizada</h1>
          <p className="text-slate-400">
            Gracias por participar. El equipo de {info?.company ?? 'la empresa'} estará en contacto contigo.
          </p>
          {info?.company && (
            <p className="text-slate-500 text-sm">{info.jobTitle} · {info.company}</p>
          )}
        </div>
      </div>
    );
  }

  // Sala de espera (waiting) — splash antes de unirse
  if (phase === 'waiting') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white">
        <div className="text-center space-y-8 max-w-lg mx-auto px-4">
          <div className="w-32 h-32 mx-auto">
            <BotAvatar listening />
          </div>
          <div>
            <h1 className="text-2xl font-semibold mb-1">
              {info?.jobTitle ?? 'Entrevista'}
            </h1>
            <p className="text-slate-400">
              {info?.company ?? ''}
              {info?.candidateName ? ` · Hola, ${info.candidateName}` : ''}
            </p>
          </div>
          <div className="text-sm text-slate-500 space-y-2">
            <p>leIA conducirá la entrevista. Asegurate de tener cámara y micrófono listos.</p>
          </div>
          <button
            onClick={joinSala}
            className="bg-blue-600 hover:bg-blue-500 transition-colors text-white font-semibold px-8 py-3 rounded-xl text-lg"
          >
            Unirse a la entrevista
          </button>
        </div>
      </div>
    );
  }

  // Sala en curso
  return (
    <div className="fixed inset-0 bg-slate-950 overflow-hidden">
      {/* leIA — ocupa todo el espacio excepto la franja inferior */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-[min(60vh,60vw)] aspect-square">
          <BotAvatar speaking={leiaSpeaking} listening={leiaListening} thinking={leiaThinking} />
        </div>
      </div>

      {/* Video del candidato — esquina inferior derecha */}
      <div className="absolute bottom-24 right-4 w-44 h-32 rounded-xl overflow-hidden shadow-2xl border border-white/10">
        <CandidateVideo
          candidateName={info?.candidateName ?? 'Tú'}
          cameraOn={cameraOn}
          micOn={micOn}
          speaking={listening}
        />
      </div>

      {/* Subtítulo (pregunta actual) */}
      {subtitle && (
        <div className="absolute bottom-16 left-4 right-52 text-center">
          <p className="text-white/90 text-lg font-medium px-4 py-2 bg-black/50 backdrop-blur rounded-2xl inline-block max-w-2xl mx-auto">
            {subtitle}
          </p>
        </div>
      )}

      {/* Transcript interim del candidato */}
      {interimText && (
        <div className="absolute bottom-4 left-4 right-52">
          <p className="text-slate-400 text-sm text-center italic truncate">
            {interimText}
          </p>
        </div>
      )}

      {/* Barra de controles inferior */}
      <div className="absolute bottom-0 inset-x-0 h-16 flex items-center justify-center gap-4 bg-black/40 backdrop-blur">
        <ControlBtn
          active={micOn}
          onIcon="🎤"
          offIcon="🔇"
          label={micOn ? 'Silenciar' : 'Activar mic'}
          onClick={() => {
            const next = !micOn;
            setMicOn(next);
            if (!next) stopListening();
          }}
        />
        <ControlBtn
          active={cameraOn}
          onIcon="📷"
          offIcon="🚫"
          label={cameraOn ? 'Apagar cámara' : 'Encender cámara'}
          onClick={() => setCameraOn((v) => !v)}
        />
        {listening && (
          <div className="flex items-center gap-2 text-sm text-green-400">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            Escuchando...
          </div>
        )}
      </div>

      {/* Nombre empresa en top */}
      {info && (
        <div className="absolute top-4 left-4 text-white/60 text-sm">
          {info.jobTitle} · {info.company}
        </div>
      )}
    </div>
  );
}

function ControlBtn({
  active,
  onIcon,
  offIcon,
  label,
  onClick,
}: {
  active: boolean;
  onIcon: string;
  offIcon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      title={label}
      onClick={onClick}
      className={`w-11 h-11 rounded-full flex items-center justify-center text-xl transition-colors ${
        active ? 'bg-white/15 hover:bg-white/25' : 'bg-red-500/80 hover:bg-red-500'
      }`}
    >
      {active ? onIcon : offIcon}
    </button>
  );
}
