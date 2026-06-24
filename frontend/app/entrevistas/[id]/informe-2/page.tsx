'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Layout } from '@/components/Layout';
import { ScoreBar, ScoreCircle } from '@/components/ScoreBar';
import { RecommendationBadge } from '@/components/StatusBadge';
import { AnalyticsDonut } from '@/components/AnalyticsDonut';
import { apiGetReport } from '@/lib/api';
import { DIMENSION_LABELS } from '@/lib/types';
import type { Report, Report2Payload, Candidate, Job, Interview } from '@/lib/types';

export default function Informe2Page() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [meta, setMeta] = useState<{ candidate?: Candidate | null; job?: Job | null; interview?: Interview | null }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiGetReport(id, 2);
        setReport(data.report);
        setMeta({ candidate: data.candidate, job: data.job, interview: data.interview });
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <Layout><p className="text-slate-500">Cargando…</p></Layout>;
  if (error || !report) return <Layout><p className="text-red-600">{error ?? 'Informe no disponible'}</p></Layout>;
  const p = report.payload as Report2Payload;

  return (
    <Layout>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <Link href={`/entrevistas/${id}`} className="text-sm text-primary-600 hover:underline">
            ← Volver
          </Link>
          <h1 className="text-3xl font-bold text-slate-900 mt-2">Informe 2 · Evaluación y scoring</h1>
          <p className="text-slate-600 mt-1">
            {meta.candidate?.name ?? '—'} · {meta.job?.title ?? ''}
          </p>
        </div>
        <Link href={`/entrevistas/${id}/informe-1`} className="btn-secondary">Ver Informe 1</Link>
      </header>

      {p.executiveSummary && (
        <section className="card mb-6">
          <h2 className="text-lg font-semibold mb-2">Resumen ejecutivo</h2>
          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
            {p.executiveSummary}
          </p>
        </section>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <AnalyticsDonut
          eyebrow="Candidato"
          title="Análisis de sentimiento"
          footnote={analyticsFootnote(p.turnsAnalyzed, meta.interview)}
          segments={[
            { label: 'Positivo', value: p.sentimentDistribution?.positive ?? 0, color: '#22c55e' },
            { label: 'Neutral', value: p.sentimentDistribution?.neutral ?? 0, color: '#facc15' },
            { label: 'Negativo', value: p.sentimentDistribution?.negative ?? 0, color: '#ef4444' },
            { label: 'No aplica', value: p.sentimentDistribution?.notApplicable ?? 0, color: '#cbd5e1' },
          ]}
        />
        <AnalyticsDonut
          eyebrow="Candidato"
          title="Calidad de las respuestas"
          footnote={analyticsFootnote(p.turnsAnalyzed, meta.interview)}
          segments={[
            { label: 'Excelente', value: p.qualityDistribution?.excellent ?? 0, color: '#15803d' },
            { label: 'Bueno', value: p.qualityDistribution?.good ?? 0, color: '#86efac' },
            { label: 'Regular', value: p.qualityDistribution?.fair ?? 0, color: '#f59e0b' },
            { label: 'Pobre', value: p.qualityDistribution?.poor ?? 0, color: '#ef4444' },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card flex flex-col items-center justify-center">
          <ScoreCircle value={p.scoreTotal} />
          <div className="mt-4 text-center">
            <div className="text-sm text-slate-500 mb-1">Score total</div>
            <RecommendationBadge rec={p.recomendacion} />
          </div>
          <p className="mt-3 text-xs text-slate-600 text-center">{p.recomendacionReason}</p>
        </div>

        <div className="lg:col-span-2 card">
          <h2 className="text-lg font-semibold mb-4">Dimensiones</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(Object.keys(p.dimensions) as Array<keyof typeof p.dimensions>).map((k) => (
              <ScoreBar key={k} label={DIMENSION_LABELS[k]} value={p.dimensions[k]} />
            ))}
            <ScoreBar label="Soft skills (agregado)" value={p.softskills} />
          </div>
        </div>

        <div className="card lg:col-span-2">
          <h2 className="text-lg font-semibold mb-4">Stack del puesto</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(p.stackScores).map(([k, v]) => (
              <ScoreBar key={k} label={k} value={v} />
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {p.flags.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold mb-2">Flags</h2>
              <div className="flex flex-wrap gap-1">
                {p.flags.map((f) => (
                  <span key={f} className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}

          {p.suspectedReading && (
            <div className="card bg-red-50 border-red-200">
              <h2 className="text-sm font-semibold mb-1 text-red-800">Sospecha de lectura</h2>
              <p className="text-xs text-red-700">
                El análisis facial detectó mirada baja prolongada y sostenida. Sugerimos revisar la
                grabación o coordinar una segunda instancia.
              </p>
            </div>
          )}
        </div>

        {((p.behavioralObservations && p.behavioralObservations.length > 0) || p.behavior) && (
          <div className="card lg:col-span-3">
            <h2 className="text-lg font-semibold mb-3">Lo que observamos en cámara</h2>
            {p.behavioralObservations && p.behavioralObservations.length > 0 && (
              <ul className="text-sm list-disc list-inside text-slate-700 space-y-1 mb-3">
                {p.behavioralObservations.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            )}
            {p.behavior && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <Metric label="Presencia" value={`${pct(p.behavior.faceVisibleSec, p.behavior.durationSec)}%`} />
                <Metric label="Atento" value={`${pct(p.behavior.attentionSec.attentive, p.behavior.durationSec)}%`} />
                <Metric label="Mirada baja" value={`${pct(p.behavior.attentionSec.reading, p.behavior.durationSec)}%`} />
                <Metric label="Cámara apagada" value={`${pct(p.behavior.cameraOffSec, p.behavior.durationSec)}%`} />
                <Metric label="Episodios lectura" value={`${p.behavior.readingEvents}`} />
                <Metric label="Expresión dominante" value={p.behavior.dominantExpression} />
              </div>
            )}
          </div>
        )}

        <div className="card lg:col-span-2">
          <h2 className="text-lg font-semibold mb-3 text-green-700">Fortalezas</h2>
          <ul className="text-sm list-disc list-inside text-slate-700 space-y-1">
            {p.strengths.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>

        <div className="card lg:col-span-2">
          <h2 className="text-lg font-semibold mb-3 text-red-700">Debilidades</h2>
          <ul className="text-sm list-disc list-inside text-slate-700 space-y-1">
            {p.weaknesses.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      </div>
    </Layout>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
      <div className="text-[10px] uppercase text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function pct(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function analyticsFootnote(turns: number, interview?: Interview | null): string {
  const n = turns ?? 0;
  const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString('es-AR') : null);
  const start = fmt(interview?.startedAt);
  const end = fmt(interview?.endedAt) ?? fmt(interview?.startedAt);
  const base = `Calculado sobre ${n} ${n === 1 ? 'respuesta' : 'respuestas'}`;
  return start ? `${base} · ${start}${end && end !== start ? ` a ${end}` : ''}` : base;
}
