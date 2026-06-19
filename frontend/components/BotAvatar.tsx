'use client';

import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';

interface Props {
  speaking?: boolean;
  listening?: boolean;
  thinking?: boolean;
}

/**
 * Avatar SVG animado de leIA.
 * - Idle: respira y parpadea cada 4-6 s.
 * - Speaking: boca animada al ritmo de la voz, ondas pulsando.
 * - Listening: anillo recibiendo pulsos hacia adentro.
 * - Thinking: tres puntos arriba.
 */
export function BotAvatar({ speaking, listening, thinking }: Props) {
  const [blink, setBlink] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(0); // 0..1
  const mouthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Parpadeo periódico
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      setBlink(true);
      setTimeout(() => setBlink(false), 140);
      t = setTimeout(tick, 3500 + Math.random() * 2500);
    };
    t = setTimeout(tick, 1800);
    return () => clearTimeout(t);
  }, []);

  // Animación de la boca cuando habla
  useEffect(() => {
    if (mouthTimerRef.current) clearInterval(mouthTimerRef.current);
    if (speaking) {
      mouthTimerRef.current = setInterval(() => {
        setMouthOpen(Math.random() * 0.9 + 0.1);
      }, 110);
    } else {
      setMouthOpen(0);
    }
    return () => {
      if (mouthTimerRef.current) clearInterval(mouthTimerRef.current);
    };
  }, [speaking]);

  const mouthRy = 2 + mouthOpen * 8; // radio vertical de la elipse de la boca

  return (
    <div className="relative w-full h-full flex items-center justify-center select-none">
      {/* Anillos de "ondas" */}
      <div
        className={clsx(
          'absolute rounded-full transition-all duration-500',
          speaking ? 'opacity-60' : 'opacity-0'
        )}
        style={{
          width: '92%',
          height: '92%',
          boxShadow: '0 0 0 4px rgba(59,130,246,0.25), 0 0 60px 10px rgba(59,130,246,0.35)',
          animation: speaking ? 'leia-pulse 1.8s ease-in-out infinite' : undefined,
        }}
      />
      <div
        className={clsx(
          'absolute rounded-full border border-white/15 transition-all duration-500',
          listening ? 'opacity-100' : 'opacity-0'
        )}
        style={{
          width: '92%',
          height: '92%',
          animation: listening ? 'leia-listen 2.2s ease-in-out infinite' : undefined,
        }}
      />

      {/* Cabeza */}
      <svg
        viewBox="0 0 200 200"
        className="relative z-10 drop-shadow-[0_4px_30px_rgba(59,130,246,0.35)]"
        style={{
          width: '70%',
          height: '70%',
          animation: 'leia-breath 4.6s ease-in-out infinite',
        }}
      >
        <defs>
          <linearGradient id="faceGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#dbeafe" />
            <stop offset="60%" stopColor="#93c5fd" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
          <radialGradient id="cheek" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fda4af" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#fda4af" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Cabeza */}
        <ellipse cx="100" cy="105" rx="78" ry="85" fill="url(#faceGrad)" />

        {/* Flequillo */}
        <path
          d="M 30 70 Q 60 25, 100 30 Q 145 28, 170 65 Q 150 55, 130 60 Q 110 50, 100 60 Q 80 56, 65 65 Q 45 60, 30 70 Z"
          fill="#1e3a8a"
        />

        {/* Mejillas */}
        <circle cx="58" cy="125" r="14" fill="url(#cheek)" />
        <circle cx="142" cy="125" r="14" fill="url(#cheek)" />

        {/* Ojos */}
        <g>
          {/* Izq */}
          <ellipse
            cx="72"
            cy="110"
            rx="9"
            ry={blink ? 0.6 : 10}
            fill="#0f172a"
            style={{ transition: 'all 90ms ease-out' }}
          />
          {!blink && <circle cx="74" cy="107" r="3" fill="#ffffff" />}
          {/* Der */}
          <ellipse
            cx="128"
            cy="110"
            rx="9"
            ry={blink ? 0.6 : 10}
            fill="#0f172a"
            style={{ transition: 'all 90ms ease-out' }}
          />
          {!blink && <circle cx="130" cy="107" r="3" fill="#ffffff" />}
        </g>

        {/* Cejas */}
        <path
          d="M 60 92 Q 72 85, 84 92"
          stroke="#1e3a8a"
          strokeWidth="3.5"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 116 92 Q 128 85, 140 92"
          stroke="#1e3a8a"
          strokeWidth="3.5"
          fill="none"
          strokeLinecap="round"
        />

        {/* Nariz */}
        <path
          d="M 100 122 Q 96 138, 100 144 Q 104 138, 100 122"
          fill="none"
          stroke="#1e3a8a"
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity="0.55"
        />

        {/* Boca */}
        <g style={{ transition: 'all 80ms ease-out' }}>
          {speaking ? (
            <ellipse
              cx="100"
              cy={160}
              rx={11 + mouthOpen * 2}
              ry={mouthRy}
              fill="#1e293b"
            />
          ) : (
            <path
              d="M 86 162 Q 100 172, 114 162"
              stroke="#1e293b"
              strokeWidth="3.5"
              fill="none"
              strokeLinecap="round"
            />
          )}
        </g>
      </svg>

      {/* "Pensando" — tres puntos */}
      {thinking && !speaking && (
        <div className="absolute top-2 right-4 flex gap-1.5 items-center bg-white/10 backdrop-blur rounded-full px-3 py-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: '120ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: '240ms' }} />
        </div>
      )}

      <style jsx>{`
        @keyframes leia-pulse {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.06); opacity: 0.9; }
        }
        @keyframes leia-breath {
          0%, 100% { transform: scale(1) translateY(0); }
          50% { transform: scale(1.015) translateY(-2px); }
        }
        @keyframes leia-listen {
          0% { transform: scale(1); opacity: 0.9; }
          100% { transform: scale(0.86); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
