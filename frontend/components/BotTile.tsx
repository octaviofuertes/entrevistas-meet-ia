'use client';

import { clsx } from 'clsx';
import { BotAvatar } from './BotAvatar';

interface Props {
  speaking?: boolean;
  listening?: boolean;
  thinking?: boolean;
  status?: string;
}

export function BotTile({ speaking, listening, thinking, status }: Props) {
  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden border border-white/10 shadow-xl bg-gradient-to-br from-slate-800 via-slate-900 to-blue-950">
      <BotAvatar speaking={speaking} listening={listening} thinking={thinking} />

      {/* Borde activo al hablar */}
      <div
        className={clsx(
          'absolute inset-0 pointer-events-none rounded-2xl transition-all',
          speaking ? 'shadow-[inset_0_0_0_3px_rgba(59,130,246,0.85)]' : ''
        )}
      />

      {/* Bottom bar */}
      <div className="absolute bottom-0 left-0 right-0 px-3 py-2 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent">
        <div className="flex items-center gap-2 text-sm text-white">
          <span className="w-7 h-7 rounded-full grid place-items-center bg-primary-500/80 font-semibold">
            L
          </span>
          <span className="font-medium">leIA</span>
        </div>
        {status && (
          <span className="text-[11px] px-2 py-0.5 rounded-full border bg-white/10 border-white/20 text-white/90">
            {status}
          </span>
        )}
      </div>
    </div>
  );
}
