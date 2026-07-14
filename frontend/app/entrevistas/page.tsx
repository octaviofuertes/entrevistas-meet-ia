'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Layout } from '@/components/Layout';
import { StatusBadge } from '@/components/StatusBadge';
import {
  apiListInterviews,
  apiListCandidates,
  apiListJobs,
  apiDeleteInterview,
} from '@/lib/api';
import type { Interview, Candidate, Job } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function EntrevistasPage() {
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [i, c, j] = await Promise.all([
      apiListInterviews(),
      apiListCandidates(),
      apiListJobs(),
    ]);
    setInterviews(i);
    setCandidates(c);
    setJobs(j);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const onDelete = async (id: string) => {
    if (!confirm('¿Eliminar esta entrevista?')) return;
    await apiDeleteInterview(id);
    load();
  };

  return (
    <Layout>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Entrevistas</h1>
          <p className="text-slate-600 mt-1">{interviews.length} entrevistas en total</p>
        </div>
        <Link href="/entrevistas/nueva" className="btn-primary">+ Nueva entrevista</Link>
      </header>

      {loading ? (
        <p className="text-slate-500">Cargando...</p>
      ) : interviews.length === 0 ? (
        <div className="card text-slate-500 text-sm">
          Todavía no hay entrevistas.{' '}
          <Link href="/entrevistas/nueva" className="text-primary-600 hover:underline">
            Crear la primera
          </Link>
        </div>
      ) : (
        <div className="card">
          <table className="w-full text-sm">
            <thead className="text-slate-600 border-b border-slate-200">
              <tr>
                <th className="text-left py-2">Candidato</th>
                <th className="text-left py-2">Puesto</th>
                <th className="text-left py-2">Estado</th>
                <th className="text-left py-2">Creada</th>
                <th className="text-left py-2">Grabación</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {interviews.map((iv) => {
                const cand = candidates.find((c) => c.id === iv.candidateId);
                const job = jobs.find((j) => j.id === iv.jobId);
                return (
                  <tr key={iv.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 font-medium">{cand?.name ?? '—'}</td>
                    <td className="py-3 text-slate-700">{job?.title ?? '—'}</td>
                    <td className="py-3"><StatusBadge status={iv.status} /></td>
                    <td className="py-3 text-slate-500">
                      {new Date(iv.createdAt).toLocaleDateString('es-AR')}
                    </td>
                    <td className="py-2">
                      {iv.mode === 'browser' && iv.status === 'en_curso' ? (
                        <span className="text-xs text-slate-400">Grabando...</span>
                      ) : iv.mode === 'browser' ? (
                        <video
                          src={`${API_URL}/api/sala/${iv.id}/recording`}
                          controls
                          preload="metadata"
                          onError={e => { (e.currentTarget as HTMLVideoElement).style.display = 'none'; }}
                          style={{ width: 160, height: 90, borderRadius: 6, background: '#000', display: 'block' }}
                        />
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="py-3 text-right whitespace-nowrap">
                      <Link
                        href={`/entrevistas/${iv.id}`}
                        className="text-primary-600 hover:underline mr-3"
                      >
                        Detalle
                      </Link>
                      {iv.status === 'en_curso' && iv.meetUrl && iv.mode !== 'browser' && (
                        <a
                          href={iv.meetUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-green-600 hover:underline mr-3"
                        >
                          ▶ Meet
                        </a>
                      )}
                      {iv.status === 'completada' && (
                        <Link
                          href={`/entrevistas/${iv.id}/informe`}
                          className="text-blue-600 hover:underline mr-3"
                        >
                          Informe 2
                        </Link>
                      )}
                      <button onClick={() => onDelete(iv.id)} className="text-red-600 hover:underline">
                        Borrar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}
