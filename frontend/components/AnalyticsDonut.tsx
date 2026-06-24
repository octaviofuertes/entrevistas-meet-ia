'use client';

export interface DonutSegment {
  label: string;
  /** Porcentaje 0-100. */
  value: number;
  /** Color del segmento. */
  color: string;
}

interface Props {
  eyebrow?: string;
  title: string;
  segments: DonutSegment[];
  /** Texto al pie, ej: "Calculado sobre 12 respuestas entre …". */
  footnote?: string;
}

/**
 * Donut de analítica estilo dashboard (réplica del diseño de Sentiment /
 * Quality Analytics): anillo segmentado + leyenda con ícono, etiqueta y %.
 */
export function AnalyticsDonut({ eyebrow, title, segments, footnote }: Props) {
  const size = 180;
  const stroke = 26;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;

  const total = segments.reduce((a, s) => a + (s.value > 0 ? s.value : 0), 0);
  let offsetAcc = 0;

  return (
    <div className="card">
      {eyebrow && <div className="text-xs text-slate-400">{eyebrow}</div>}
      <h3 className="text-lg font-semibold text-slate-800 mb-4">{title}</h3>

      <div className="flex items-center justify-center">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* Pista de fondo */}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
          {total > 0 &&
            segments.map((s, i) => {
              if (s.value <= 0) return null;
              const len = (s.value / 100) * circ;
              const dashoffset = -offsetAcc;
              offsetAcc += len;
              return (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${len} ${circ - len}`}
                  strokeDashoffset={dashoffset}
                  transform={`rotate(-90 ${cx} ${cy})`}
                />
              );
            })}
        </svg>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
        {segments.map((s, i) => (
          <div key={i} className="flex flex-col items-center text-center">
            <span
              className="inline-block w-3 h-3 rounded-full mb-1"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-[11px] text-slate-500 leading-tight">{s.label}</span>
            <span className="text-sm font-semibold text-slate-800">{s.value}%</span>
          </div>
        ))}
      </div>

      {footnote && (
        <p className="text-[11px] italic text-slate-400 text-center mt-4">{footnote}</p>
      )}
    </div>
  );
}
