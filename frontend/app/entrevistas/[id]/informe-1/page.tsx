'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Layout } from '@/components/Layout';
import { apiGetReport } from '@/lib/api';
import type { Report, Report1Payload, Candidate, Job, Interview } from '@/lib/types';

export default function Informe1Page() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [meta, setMeta] = useState<{ candidate?: Candidate | null; job?: Job | null; interview?: Interview | null }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiGetReport(id, 1);
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
  const p = report.payload as Report1Payload;

  return (
    <Layout>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <Link href={`/entrevistas/${id}`} className="text-sm text-primary-600 hover:underline">
            ← Volver
          </Link>
          <h1 className="text-3xl font-bold text-slate-900 mt-2">Informe 1 · Transcripción y resumen</h1>
          <p className="text-slate-600 mt-1">
            {meta.candidate?.name ?? '—'} · {meta.job?.title ?? ''}
          </p>
        </div>
        <Link href={`/entrevistas/${id}/informe-2`} className="btn-primary">Ver Informe 2 →</Link>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <section className="card">
            <h2 className="text-lg font-semibold mb-2">Resumen ejecutivo</h2>
            <p className="text-sm text-slate-700 whitespace-pre-line">{p.summary}</p>
          </section>

          <section className="card">
            <h2 className="text-lg font-semibold mb-2">Highlights</h2>
            <ul className="text-sm list-disc list-inside text-slate-700 space-y-1">
              {p.highlights.map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          </section>

          {((p.behavioralObservations && p.behavioralObservations.length > 0) || p.behavior) && (
            <section className="card">
              <h2 className="text-lg font-semibold mb-2">Lo que observamos en cámara</h2>
              {p.behavioralObservations && p.behavioralObservations.length > 0 && (
                <ul className="text-sm list-disc list-inside text-slate-700 space-y-1 mb-3">
                  {p.behavioralObservations.map((o, i) => <li key={i}>{o}</li>)}
                </ul>
              )}
              {p.behavior && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <Metric
                    label="Presencia"
                    value={`${pct(p.behavior.faceVisibleSec, p.behavior.durationSec)}%`}
                  />
                  <Metric
                    label="Mirada baja"
                    value={`${pct(p.behavior.attentionSec.reading, p.behavior.durationSec)}%`}
                  />
                  <Metric
                    label="Episodios"
                    value={`${p.behavior.readingEvents}`}
                  />
                  <Metric
                    label="Expresión"
                    value={p.behavior.dominantExpression}
                  />
                </div>
              )}
            </section>
          )}

          <section className="card">
            <h2 className="text-lg font-semibold mb-3">Transcripción completa</h2>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {p.fullTranscript.map((l, i) => (
                <div
                  key={i}
                  className={`p-2 rounded text-sm ${
                    l.speaker === 'bot'
                      ? 'bg-primary-50 text-slate-800'
                      : 'bg-slate-50 text-slate-800'
                  }`}
                >
                  <span className="text-[10px] uppercase text-slate-500 mr-2">
                    {l.speaker === 'bot' ? 'leIA' : meta.candidate?.name ?? 'Candidato'}
                  </span>
                  {l.text}
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="card h-fit">
          <h3 className="font-semibold mb-3">Metadata</h3>
          <dl className="text-sm space-y-2">
            <Row label="Duración" value={`${Math.round(p.durationSec / 60)} min`} />
            <Row label="Idioma" value={p.language} />
            <Row label="Generado" value={new Date(report.createdAt).toLocaleString('es-AR')} />
          </dl>
        </aside>
      </div>
    </Layout>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900 text-right">{value}</dd>
    </div>
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
