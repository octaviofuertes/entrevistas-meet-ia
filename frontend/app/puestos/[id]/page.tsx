'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Layout } from '@/components/Layout';
import { StatusBadge } from '@/components/StatusBadge';
import { apiGetJob, apiListCandidates } from '@/lib/api';
import { DIMENSION_LABELS } from '@/lib/types';
import type { Job, Interview, Candidate } from '@/lib/types';

export default function PuestoDetalle() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<(Job & { interviews: Interview[] }) | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [job, cands] = await Promise.all([apiGetJob(id), apiListCandidates()]);
        setData(job);
        setCandidates(cands);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <Layout><p className="text-slate-500">Cargando…</p></Layout>;
  if (error || !data) return <Layout><p className="text-red-600">{error ?? 'No encontrado'}</p></Layout>;

  return (
    <Layout>
      <header className="mb-8">
        <Link href="/puestos" className="text-sm text-primary-600 hover:underline">
          ← Puestos
        </Link>
        <h1 className="text-3xl font-bold text-slate-900 mt-2">{data.title}</h1>
        <p className="text-slate-600">{data.company} · {data.requirements.seniority}</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <section className="card">
            <h2 className="text-lg font-semibold mb-2">Descripción</h2>
            <p className="text-sm text-slate-700 whitespace-pre-line">{data.description}</p>
            <div className="mt-4 text-xs text-slate-500">
              Fuente:{' '}
              <a
                href={data.sourceLink}
                target="_blank"
                rel="noreferrer"
                className="text-primary-600 hover:underline"
              >
                {data.sourceLink}
              </a>
            </div>
          </section>

          <section className="card">
            <h2 className="text-lg font-semibold mb-3">Entrevistas</h2>
            {data.interviews.length === 0 ? (
              <div className="text-sm text-slate-500">
                Todavía no hay entrevistas para este puesto.{' '}
                <Link href={`/entrevistas/nueva?jobId=${data.id}`} className="text-primary-600 hover:underline">
                  Agendar una
                </Link>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-slate-600">
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2">Candidato</th>
                    <th className="text-left py-2">Estado</th>
                    <th className="text-left py-2">Creada</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.interviews.map((iv) => {
                    const c = candidates.find((cc) => cc.id === iv.candidateId);
                    return (
                      <tr key={iv.id} className="border-b border-slate-100">
                        <td className="py-2">{c?.name ?? '—'}</td>
                        <td className="py-2"><StatusBadge status={iv.status} /></td>
                        <td className="py-2 text-slate-500">
                          {new Date(iv.createdAt).toLocaleDateString('es-AR')}
                        </td>
                        <td className="py-2 text-right">
                          <Link
                            href={`/entrevistas/${iv.id}`}
                            className="text-primary-600 hover:underline"
                          >
                            Ver →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <div className="mt-4">
              <Link href={`/entrevistas/nueva?jobId=${data.id}`} className="btn-primary">
                + Nueva entrevista para este puesto
              </Link>
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="card">
            <h2 className="text-lg font-semibold mb-3">Stack y requisitos</h2>
            <div className="flex flex-wrap gap-1 mb-4">
              {data.requirements.stack.map((s) => (
                <span key={s} className="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded">
                  {s}
                </span>
              ))}
            </div>
            <p className="text-xs text-slate-500 mb-1">Experiencia</p>
            <p className="text-sm mb-3">{data.requirements.yearsOfExperience}+ años</p>
            <p className="text-xs text-slate-500 mb-1">Responsabilidades</p>
            <ul className="text-sm list-disc list-inside text-slate-700 mb-3">
              {data.requirements.responsibilities.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            {data.requirements.niceToHave.length > 0 && (
              <>
                <p className="text-xs text-slate-500 mb-1">Nice to have</p>
                <ul className="text-sm list-disc list-inside text-slate-700">
                  {data.requirements.niceToHave.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="card">
            <h2 className="text-lg font-semibold mb-3">Preferencias</h2>
            <p className="text-sm">
              Duración: <strong>{data.preferences.durationMinutes} min</strong>
            </p>
            <p className="text-sm">
              Tono: <strong>{data.preferences.toneOfVoice}</strong>
            </p>
            <p className="text-sm mt-3 mb-1 text-xs text-slate-500">Dimensiones</p>
            <div className="flex flex-wrap gap-1">
              {data.preferences.dimensionsToCover.map((d) => (
                <span key={d} className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                  {DIMENSION_LABELS[d]}
                </span>
              ))}
            </div>
            <p className="text-sm mt-3">
              Informe 1: <strong>{data.preferences.generateReport1 ? 'sí' : 'no'}</strong>{' '}
              · Informe 2: <strong>{data.preferences.generateReport2 ? 'sí' : 'no'}</strong>
            </p>
          </section>
        </aside>
      </div>
    </Layout>
  );
}
