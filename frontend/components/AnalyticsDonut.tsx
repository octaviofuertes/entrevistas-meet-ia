'use client';

export type FaceKind = 'happy' | 'neutral' | 'sad' | 'na';

export interface DonutSegment {
  label: string;
  /** Porcentaje 0-100. */
  value: number;
  /** Color del segmento. */
  color: string;
  /** Carita que representa el segmento. */
  face: FaceKind;
}

interface Props {
  eyebrow?: string;
  title: string;
  segments: DonutSegment[];
  footnote?: string;
}

/** Carita de color (estilo dashboard de sentimiento). */
function Face({ kind, color, size = 26 }: { kind: FaceKind; color: string; size?: number }) {
  const s = size;
  const eyeY = s * 0.4;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill={color} />
      {kind === 'na' ? (
        // Círculo con X (no aplica)
        <>
          <line x1="8" y1="8" x2="16" y2="16" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          <line x1="16" y1="8" x2="8" y2="16" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="8.5" cy="10" r="1.4" fill="#fff" />
          <circle cx="15.5" cy="10" r="1.4" fill="#fff" />
          {kind === 'happy' && (
            <path d="M7.5 14 Q12 18 16.5 14" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          )}
          {kind === 'neutral' && (
            <line x1="8" y1="15" x2="16" y2="15" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          )}
          {kind === 'sad' && (
            <path d="M7.5 16 Q12 12 16.5 16" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          )}
        </>
      )}
    </svg>
  );
}

/**
 * Donut de analítica estilo dashboard (Sentiment / Quality Analytics):
 * anillo segmentado + leyenda con carita de color, etiqueta y %.
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
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
          {total > 0 &&
            segments.map((seg, i) => {
              if (seg.value <= 0) return null;
              const len = (seg.value / 100) * circ;
              const dashoffset = -offsetAcc;
              offsetAcc += len;
              return (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={seg.color}
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
        {segments.map((seg, i) => (
          <div key={i} className="flex flex-col items-center text-center gap-1">
            <Face kind={seg.face} color={seg.color} />
            <span className="text-[11px] text-slate-500 leading-tight">{seg.label}</span>
            <span className="text-sm font-semibold text-slate-800">{seg.value}%</span>
          </div>
        ))}
      </div>

      {footnote && (
        <p className="text-[11px] italic text-slate-400 text-center mt-4">{footnote}</p>
      )}
    </div>
  );
}
