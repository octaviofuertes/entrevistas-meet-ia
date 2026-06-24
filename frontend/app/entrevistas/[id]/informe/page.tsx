'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Layout } from '@/components/Layout';
import { ScoreBar, ScoreCircle } from '@/components/ScoreBar';
import { RecommendationBadge } from '@/components/StatusBadge';
import { AnalyticsDonut } from '@/components/AnalyticsDonut';
import { RadarChart } from '@/components/RadarChart';
import { apiGetReport } from '@/lib/api';
import { DIMENSION_LABELS, ALL_DIMENSIONS } from '@/lib/types';
import type { Report1Payload, Report2Payload, Candidate, Job, Interview } from '@/lib/types';

const EXPECTED_BY_SENIORITY: Record<string, number> = {
  junior: 5,
  semi: 6,
  senior: 7.5,
  lead: 8.5,
};

export default function InformePage() {
  const { id } = useParams<{ id: string }>();
  const [r1, setR1] = useState<Report1Payload | null>(null);
  const [r2, setR2] = useState<Report2Payload | null>(null);
  const [meta, setMeta] = useState<{ candidate?: Candidate | null; job?: Job | null; interview?: Interview | null }>({});
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // El informe 2 es el principal (scoring + analítica). El 1 aporta la
        // transcripción y la narrativa; puede no existir.
        const d2 = await apiGetReport(id, 2);
        setR2(d2.report.payload as Report2Payload);
        setMeta({ candidate: d2.candidate, job: d2.job, interview: d2.interview });
        setCreatedAt(d2.report.createdAt);
        try {
          const d1 = await apiGetReport(id, 1);
          setR1(d1.report.payload as Report1Payload);
        } catch {
          /* informe 1 opcional */
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <Layout><p className="text-slate-500">Cargando…</p></Layout>;
  if (error || !r2) return <Layout><p className="text-red-600">{error ?? 'Informe no disponible'}</p></Layout>;

  const summary = r2.executiveSummary || r1?.summary || '';
  const seniority = meta.job?.requirements?.seniority ?? 'semi';
  const expected = EXPECTED_BY_SENIORITY[seniority] ?? 6;
  const radarAxes = ALL_DIMENSIONS.map((d) => DIMENSION_LABELS[d]);
  const radarSeries = [
    {
      name: 'Candidato',
      color: '#6366f1',
      fill: 'rgba(99,102,241,0.18)',
      values: ALL_DIMENSIONS.map((d) => r2.dimensions[d]),
    },
    {
      name: `Esperado (${seniority})`,
      color: '#22c55e',
      fill: 'rgba(34,197,94,0.10)',
      values: ALL_DIMENSIONS.map(() => expected),
    },
  ];

  const behavioral = r2.behavioralObservations ?? r1?.behavioralObservations ?? [];

  return (
    <Layout>
      <header className="mb-6">
        <Link href={`/entrevistas/${id}`} className="text-sm text-primary-600 hover:underline">
          ← Volver
        </Link>
        <div className="flex flex-col md:flex-row md:items-end md:justify-between mt-2 gap-2">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Informe de entrevista</h1>
            <p className="text-slate-600 mt-1">
              {meta.candidate?.name ?? '—'} · {meta.job?.title ?? ''} {meta.job?.company ? `· ${meta.job.company}` : ''}
            </p>
          </div>
          {createdAt && (
            <p className="text-xs text-slate-400">
              Generado el {new Date(createdAt).toLocaleString('es-AR')}
            </p>
          )}
        </div>
      </header>

      {/* Recomendación + score + resumen ejecutivo */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="card flex flex-col items-center justify-center">
          <ScoreCircle value={r2.scoreTotal} />
          <div className="mt-4 text-center">
            <div className="text-sm text-slate-500 mb-1">Score total</div>
            <RecommendationBadge rec={r2.recomendacion} />
          </div>
        </div>
        <div className="card lg:col-span-2">
          <h2 className="text-lg font-semibold mb-2">Resumen ejecutivo</h2>
          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{summary}</p>
          {r2.recomendacionReason && (
            <p className="text-sm text-slate-600 mt-3 pt-3 border-t border-slate-100">
              <span className="font-medium text-slate-700">Recomendación: </span>
              {r2.recomendacionReason}
            </p>
          )}
        </div>
      </section>

      {/* Perfil de competencias (radar) */}
      <section className="card mb-6">
        <h2 className="text-lg font-semibold mb-1">Perfil de competencias</h2>
        <p className="text-xs text-slate-400 mb-3">Resultado del candidato vs. nivel esperado para el puesto</p>
        <RadarChart axes={radarAxes} series={radarSeries} max={10} />
      </section>

      {/* Analíticas tipo dashboard */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <AnalyticsDonut
          eyebrow="Candidato"
          title="Análisis de sentimiento"
          footnote={footnote(r2.turnsAnalyzed, meta.interview)}
          segments={[
            { label: 'Positivo', value: r2.sentimentDistribution?.positive ?? 0, color: '#22c55e', face: 'happy' },
            { label: 'Neutral', value: r2.sentimentDistribution?.neutral ?? 0, color: '#facc15', face: 'neutral' },
            { label: 'Negativo', value: r2.sentimentDistribution?.negative ?? 0, color: '#ef4444', face: 'sad' },
            { label: 'No aplica', value: r2.sentimentDistribution?.notApplicable ?? 0, color: '#cbd5e1', face: 'na' },
          ]}
        />
        <AnalyticsDonut
          eyebrow="Candidato"
          title="Calidad de las respuestas"
          footnote={footnote(r2.turnsAnalyzed, meta.interview)}
          segments={[
            { label: 'Excelente', value: r2.qualityDistribution?.excellent ?? 0, color: '#15803d', face: 'happy' },
            { label: 'Bueno', value: r2.qualityDistribution?.good ?? 0, color: '#4ade80', face: 'happy' },
            { label: 'Regular', value: r2.qualityDistribution?.fair ?? 0, color: '#f59e0b', face: 'neutral' },
            { label: 'Pobre', value: r2.qualityDistribution?.poor ?? 0, color: '#ef4444', face: 'sad' },
          ]}
        />
      </section>

      {/* Dimensiones + stack */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Dimensiones</h2>
          <div className="space-y-3">
            {ALL_DIMENSIONS.map((d) => (
              <ScoreBar key={d} label={DIMENSION_LABELS[d]} value={r2.dimensions[d]} />
            ))}
            <ScoreBar label="Soft skills (agregado)" value={r2.softskills} />
          </div>
        </div>
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Stack del puesto</h2>
          <div className="space-y-3">
            {Object.entries(r2.stackScores).map(([k, v]) => (
              <ScoreBar key={k} label={k} value={v} />
            ))}
          </div>
        </div>
      </section>

      {/* Fortalezas / Debilidades */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="card">
          <h2 className="text-lg font-semibold mb-3 text-green-700">Fortalezas</h2>
          <ul className="text-sm list-disc list-inside text-slate-700 space-y-1">
            {r2.strengths.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
        <div className="card">
          <h2 className="text-lg font-semibold mb-3 text-red-700">Debilidades</h2>
          <ul className="text-sm list-disc list-inside text-slate-700 space-y-1">
            {r2.weaknesses.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      </section>

      {/* Narrativa cualitativa (del informe 1) */}
      {r1 && (r1.highlights?.length || r1.keyMoments?.length || r1.topicsCovered?.length || r1.concerns?.length) ? (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {r1.highlights?.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold mb-3">Highlights</h2>
              <ul className="text-sm list-disc list-inside text-slate-700 space-y-1">
                {r1.highlights.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            </div>
          )}
          {r1.keyMoments && r1.keyMoments.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold mb-3">Momentos clave</h2>
              <ul className="text-sm list-disc list-inside text-slate-700 space-y-1">
                {r1.keyMoments.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}
          {r1.topicsCovered && r1.topicsCovered.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold mb-3">Temas cubiertos</h2>
              <div className="flex flex-wrap gap-2">
                {r1.topicsCovered.map((t, i) => (
                  <span key={i} className="text-xs bg-primary-50 text-primary-700 px-2 py-1 rounded-full">{t}</span>
                ))}
              </div>
            </div>
          )}
          {r1.concerns && r1.concerns.length > 0 && (
            <div className="card border-amber-200 bg-amber-50">
              <h2 className="text-lg font-semibold mb-3 text-amber-800">Puntos de atención</h2>
              <ul className="text-sm list-disc list-inside text-amber-900 space-y-1">
                {r1.concerns.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}
        </section>
      ) : null}

      {/* Comportamiento (cámara) */}
      {(behavioral.length > 0 || r2.suspectedReading) && (
        <section className="card mb-6">
          <h2 className="text-lg font-semibold mb-3">Observaciones de comportamiento</h2>
          {r2.suspectedReading && (
            <div className="mb-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-3">
              Se detectó mirada baja prolongada — posible lectura asistida. Sugerimos revisar la grabación.
            </div>
          )}
          {behavioral.length > 0 && (
            <ul className="text-sm list-disc list-inside text-slate-700 space-y-1">
              {behavioral.map((o, i) => <li key={i}>{o}</li>)}
            </ul>
          )}
        </section>
      )}

      {/* Transcripción (colapsable) */}
      {r1?.fullTranscript && r1.fullTranscript.length > 0 && (
        <section className="card mb-6">
          <button
            onClick={() => setShowTranscript((v) => !v)}
            className="flex items-center justify-between w-full text-left"
          >
            <h2 className="text-lg font-semibold">Transcripción completa</h2>
            <span className="text-sm text-primary-600">{showTranscript ? 'Ocultar' : 'Ver'}</span>
          </button>
          {showTranscript && (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto mt-3">
              {r1.fullTranscript.map((l, i) => (
                <div
                  key={i}
                  className={`p-2 rounded text-sm ${l.speaker === 'bot' ? 'bg-primary-50' : 'bg-slate-50'} text-slate-800`}
                >
                  <span className="text-[10px] uppercase text-slate-500 mr-2">
                    {l.speaker === 'bot' ? 'leIA' : meta.candidate?.name ?? 'Candidato'}
                  </span>
                  {l.text}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </Layout>
  );
}

function footnote(turns: number, interview?: Interview | null): string {
  const n = turns ?? 0;
  const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString('es-AR') : null);
  const start = fmt(interview?.startedAt);
  const end = fmt(interview?.endedAt) ?? start;
  const base = `Calculado sobre ${n} ${n === 1 ? 'respuesta' : 'respuestas'}`;
  return start ? `${base} · ${start}${end && end !== start ? ` a ${end}` : ''}` : base;
}
