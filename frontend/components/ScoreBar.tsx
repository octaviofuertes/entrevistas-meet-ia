import { clsx } from 'clsx';

export function ScoreBar({
  label,
  value,
  max = 10,
}: {
  label: string;
  value: number;
  max?: number;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color =
    value >= max * 0.75 ? 'bg-green-500' : value >= max * 0.55 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div>
      <div className="flex items-center justify-between mb-1 text-sm">
        <span className="text-slate-700 capitalize">{label}</span>
        <span className="font-semibold text-slate-900">
          {value.toFixed(1)}
          <span className="text-slate-400 text-xs font-normal"> / {max}</span>
        </span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={clsx('h-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ScoreCircle({ value, max = 10 }: { value: number; max?: number }) {
  const radius = 56;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(1, value / max));
  const offset = circumference - pct * circumference;
  const color = pct >= 0.75 ? '#10b981' : pct >= 0.55 ? '#f59e0b' : '#ef4444';
  return (
    <div className="relative w-32 h-32">
      <svg className="transform -rotate-90 w-full h-full">
        <circle cx="64" cy="64" r={radius} stroke="#e2e8f0" strokeWidth="10" fill="none" />
        <circle
          cx="64"
          cy="64"
          r={radius}
          stroke={color}
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          fill="none"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-3xl font-bold text-slate-900">{value.toFixed(1)}</div>
        <div className="text-xs text-slate-500">/ {max}</div>
      </div>
    </div>
  );
}
