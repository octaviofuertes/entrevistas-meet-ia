'use client';

import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { useFaceAnalysis, type FaceMetrics } from '@/lib/useFaceAnalysis';

interface Props {
  candidateName: string;
  cameraOn: boolean;
  micOn: boolean;
  speaking?: boolean;
  onMetrics?: (m: FaceMetrics) => void;
}

export function CandidateVideo({
  candidateName,
  cameraOn,
  micOn,
  speaking,
  onMetrics,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Start/stop cámara según el toggle
  useEffect(() => {
    let cancelled = false;
    async function go() {
      if (!cameraOn) {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
        if (videoRef.current) videoRef.current.srcObject = null;
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: 'user' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err: any) {
        setError(err?.message ?? 'No se pudo acceder a la cámara');
      }
    }
    go();
    return () => {
      cancelled = true;
    };
  }, [cameraOn]);

  // Liberar al desmontar
  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const metrics = useFaceAnalysis(videoRef, cameraOn);

  // Propagar metrics al padre (panel lateral)
  useEffect(() => {
    onMetrics?.(metrics);
  }, [metrics, onMetrics]);

  return (
    <div className="relative w-full h-full bg-slate-950 rounded-2xl overflow-hidden border border-white/10 shadow-xl">
      {/* Video */}
      {cameraOn ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover scale-x-[-1]"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-3">
          <div className="w-24 h-24 rounded-full bg-white/10 grid place-items-center text-3xl font-semibold text-white">
            {candidateName?.[0]?.toUpperCase() ?? 'C'}
          </div>
          <span className="text-sm">Cámara apagada</span>
        </div>
      )}

      {/* Borde luminoso cuando habla */}
      <div
        className={clsx(
          'absolute inset-0 pointer-events-none rounded-2xl transition-all',
          speaking ? 'shadow-[inset_0_0_0_3px_rgba(59,130,246,0.8)]' : ''
        )}
      />

      {/* Bottom bar: nombre + estado mic + atención */}
      <div className="absolute bottom-0 left-0 right-0 px-3 py-2 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent">
        <div className="flex items-center gap-2 text-sm text-white">
          <span
            className={clsx(
              'w-7 h-7 rounded-full grid place-items-center',
              micOn ? 'bg-white/15' : 'bg-red-500/80'
            )}
            title={micOn ? 'Micrófono encendido' : 'Micrófono apagado'}
          >
            {micOn ? '🎤' : '🔇'}
          </span>
          <span className="font-medium">{candidateName ?? 'Candidato'}</span>
        </div>
        {cameraOn && metrics.ready && (
          <AttentionBadge metrics={metrics} />
        )}
      </div>

      {/* Banner si falla acceso */}
      {error && (
        <div className="absolute top-2 left-2 right-2 bg-red-900/70 text-red-100 text-xs rounded-lg p-2">
          {error}
        </div>
      )}
    </div>
  );
}

function AttentionBadge({ metrics }: { metrics: FaceMetrics }) {
  const map: Record<FaceMetrics['attention'], { label: string; cls: string; icon: string }> = {
    attentive:  { label: 'Atento',              cls: 'bg-green-500/20 text-green-200 border-green-400/40',  icon: '●' },
    reading:    { label: 'Mirando hacia abajo', cls: 'bg-amber-500/25 text-amber-100 border-amber-400/50', icon: '↓' },
    distracted: { label: 'Mirando al costado',  cls: 'bg-amber-500/25 text-amber-100 border-amber-400/50', icon: '↔' },
    absent:     { label: 'Sin cara',            cls: 'bg-red-500/25 text-red-100 border-red-400/50',       icon: '∅' },
    sleepy:     { label: 'Somnoliento',         cls: 'bg-blue-500/20 text-blue-200 border-blue-400/40',    icon: '~' },
  };
  const s = map[metrics.attention];
  return (
    <div
      className={clsx(
        'text-[11px] px-2 py-0.5 rounded-full border flex items-center gap-1',
        s.cls
      )}
      title={`Expresión: ${metrics.expressionLabel} · presencia ${(metrics.presenceRatio * 100).toFixed(0)}%`}
    >
      <span>{s.icon}</span>
      {s.label}
    </div>
  );
}
