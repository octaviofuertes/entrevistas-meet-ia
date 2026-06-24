'use client';

export interface RadarSeries {
  name: string;
  /** Valores 0..max, en el mismo orden que `axes`. */
  values: number[];
  /** Color del trazo. */
  color: string;
  /** Relleno translúcido. */
  fill: string;
}

interface Props {
  axes: string[];
  series: RadarSeries[];
  max?: number;
}

/**
 * Radar / spider chart en SVG puro (sin libs). Réplica del estilo
 * "Resultados vs Autoevaluación": grilla concéntrica, ejes etiquetados,
 * polígonos translúcidos por serie y leyenda.
 */
export function RadarChart({ axes, series, max = 10 }: Props) {
  const size = 420;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 70;
  const n = axes.length;
  const rings = 5;

  // Ángulo de cada eje (arranca arriba, sentido horario).
  const angleOf = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const point = (i: number, value: number) => {
    const r = (Math.max(0, Math.min(max, value)) / max) * radius;
    const a = angleOf(i);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  };
  const ringPath = (ring: number) => {
    const r = (ring / rings) * radius;
    return axes
      .map((_, i) => {
        const a = angleOf(i);
        return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
      })
      .join(' ');
  };
  const seriesPath = (values: number[]) =>
    values.map((v, i) => point(i, v).join(',')).join(' ');

  return (
    <div className="flex flex-col items-center">
      <svg width="100%" viewBox={`0 0 ${size} ${size}`} className="max-w-[460px]">
        {/* Anillos concéntricos */}
        {Array.from({ length: rings }, (_, k) => (
          <polygon
            key={k}
            points={ringPath(k + 1)}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={1}
          />
        ))}
        {/* Ejes + etiquetas */}
        {axes.map((label, i) => {
          const [x, y] = point(i, max);
          const [lx, ly] = (() => {
            const a = angleOf(i);
            const r = radius + 26;
            return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
          })();
          const anchor = Math.abs(lx - cx) < 12 ? 'middle' : lx > cx ? 'start' : 'end';
          return (
            <g key={i}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <text
                x={lx}
                y={ly}
                textAnchor={anchor}
                dominantBaseline="middle"
                className="fill-slate-500"
                fontSize={12}
              >
                {label}
              </text>
            </g>
          );
        })}
        {/* Series */}
        {series.map((s, si) => (
          <g key={si}>
            <polygon points={seriesPath(s.values)} fill={s.fill} stroke={s.color} strokeWidth={2} />
            {s.values.map((v, i) => {
              const [x, y] = point(i, v);
              return <circle key={i} cx={x} cy={y} r={3} fill={s.color} />;
            })}
          </g>
        ))}
      </svg>

      <div className="flex flex-wrap items-center justify-center gap-4 mt-2">
        {series.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-sm text-slate-600">
            <span className="inline-block w-4 h-2 rounded" style={{ backgroundColor: s.color }} />
            {s.name}
          </div>
        ))}
      </div>
    </div>
  );
}
