'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Layout } from '@/components/Layout';
import { StatusBadge } from '@/components/StatusBadge';
import {
  apiHealth,
  apiListCandidates,
  apiListInterviews,
  apiListJobs,
  apiGetReport,
} from '@/lib/api';
import type { Candidate, Interview, Job, Report2Payload } from '@/lib/types';

interface Ranked {
  interview: Interview;
  job?: Job;
  candidate?: Candidate;
  scoreTotal?: number;
  recomendacion?: 'avanzar' | 'segunda_instancia' | 'descartar';
}

export default function Dashboard() {
  const [health, setHealth] = useState<any>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [ranking, setRanking] = useState<Ranked[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [h, c, i, j] = await Promise.all([
          apiHealth(),
          apiListCandidates(),
          apiListInterviews(),
          apiListJobs(),
        ]);
        setHealth(h);
        setCandidates(c);
        setInterviews(i);
        setJobs(j);

        // Cargar Informe 2 de las entrevistas completadas para armar ranking
        const completed = i.filter((iv) => iv.status === 'completada').slice(0, 20);
        const r2s = await Promise.all(
          completed.map(async (iv) => {
            try {
              const r = await apiGetReport(iv.id, 2);
              return { iv, payload: r.report.payload as Report2Payload };
            } catch {
              return null;
            }
          })
        );
        const ranked: Ranked[] = r2s
          .filter(Boolean)
          .map((x: any) => ({
            interview: x.iv,
            job: j.find((jj) => jj.id === x.iv.jobId),
            candidate: c.find((cc) => cc.id === x.iv.candidateId),
            scoreTotal: x.payload.scoreTotal,
            recomendacion: x.payload.recomendacion,
          }))
          .sort((a, b) => (b.scoreTotal ?? 0) - (a.scoreTotal ?? 0));
        setRanking(ranked);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <Layout>
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-600 mt-1">leIA · entrevistas automáticas en Google Meet</p>
        </div>
        <div className="flex gap-3">
          <Link href="/puestos/nuevo" className="btn-secondary">+ Puesto desde link</Link>
          <Link href="/entrevistas/nueva" className="btn-primary">+ Nueva entrevista</Link>
        </div>
      </header>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading ? (
        <div className="text-slate-500">Cargando...</div>
      ) : (
        <>
          {health && (
            <div className="mb-8 card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Estado del sistema</h2>
                <span
                  className={`badge ${
                    health.demoMode
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-green-100 text-green-800'
                  }`}
                >
                  {health.demoMode ? 'Modo demo' : 'Producción'}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <DriverChip label="Base de datos" value={health.drivers.database} />
                <DriverChip label="leIA" value={health.drivers.leia} />
                <DriverChip label="Recall.ai" value={health.drivers.recall} />
                <DriverChip label="ElevenLabs TTS" value={health.drivers.tts} />
              </div>
              {health.demoMode && (
                <p className="mt-4 text-xs text-slate-500">
                  Modo demo: leIA, Recall.ai y ElevenLabs están en mock. Configurá las API keys en{' '}
                  <code className="bg-slate-100 px-1 rounded">.env</code> para activar drivers reales.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <StatCard title="Puestos" value={jobs.length} href="/puestos" />
            <StatCard title="Candidatos" value={candidates.length} href="/candidatos" />
            <StatCard title="Entrevistas" value={interviews.length} href="/entrevistas" />
          </div>

          {ranking.length > 0 && (
            <div className="card mb-8">
              <h2 className="text-lg font-semibold mb-4">Ranking de candidatos</h2>
              <table className="w-full text-sm">
                <thead className="text-slate-600">
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2">#</th>
                    <th className="text-left py-2">Candidato</th>
                    <th className="text-left py-2">Puesto</th>
                    <th className="text-left py-2">Score</th>
                    <th className="text-left py-2">Recomendación</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.slice(0, 10).map((r, idx) => (
                    <tr key={r.interview.id} className="border-b border-slate-100">
                      <td className="py-3 font-mono text-slate-500">{idx + 1}</td>
                      <td className="py-3 font-medium">{r.candidate?.name ?? '—'}</td>
                      <td className="py-3 text-slate-600">{r.job?.title ?? '—'}</td>
                      <td className="py-3 font-bold">
                        {r.scoreTotal?.toFixed(1)}
                        <span className="text-slate-400 text-xs"> /10</span>
                      </td>
                      <td className="py-3">
                        {r.recomendacion === 'avanzar' && (
                          <span className="badge bg-green-100 text-green-800">Avanzar</span>
                        )}
                        {r.recomendacion === 'segunda_instancia' && (
                          <span className="badge bg-yellow-100 text-yellow-800">2da instancia</span>
                        )}
                        {r.recomendacion === 'descartar' && (
                          <span className="badge bg-red-100 text-red-700">Descartar</span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <Link
                          href={`/entrevistas/${r.interview.id}/informe-2`}
                          className="text-primary-600 hover:underline text-sm font-medium"
                        >
                          Informe 2 →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Entrevistas recientes</h2>
              <Link href="/entrevistas" className="text-sm text-primary-600 hover:underline">
                Ver todas
              </Link>
            </div>
            {interviews.length === 0 ? (
              <p className="text-slate-500 text-sm">
                Todavía no hay entrevistas. Generá un puesto desde link y agendá la primera.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-slate-600">
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2">Candidato</th>
                    <th className="text-left py-2">Puesto</th>
                    <th className="text-left py-2">Estado</th>
                    <th className="text-left py-2">Creada</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {interviews.slice(0, 8).map((iv) => {
                    const cand = candidates.find((c) => c.id === iv.candidateId);
                    const job = jobs.find((j) => j.id === iv.jobId);
                    return (
                      <tr key={iv.id} className="border-b border-slate-100">
                        <td className="py-3 font-medium">{cand?.name ?? '—'}</td>
                        <td className="py-3 text-slate-600">{job?.title ?? '—'}</td>
                        <td className="py-3">
                          <StatusBadge status={iv.status} />
                        </td>
                        <td className="py-3 text-slate-500">
                          {new Date(iv.createdAt).toLocaleDateString('es-AR')}
                        </td>
                        <td className="py-3 text-right">
                          <Link
                            href={`/entrevistas/${iv.id}`}
                            className="text-primary-600 hover:underline text-sm font-medium"
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
          </div>
        </>
      )}
    </Layout>
  );
}

function DriverChip({ label, value }: { label: string; value: string }) {
  const isReal = value !== 'mock' && value !== 'memory';
  return (
    <div className="p-3 rounded-lg bg-slate-50">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${isReal ? 'bg-green-500' : 'bg-yellow-500'}`}></span>
        <span className="font-medium capitalize">{value}</span>
      </div>
    </div>
  );
}

function StatCard({ title, value, href }: { title: string; value: number; href: string }) {
  return (
    <Link href={href} className="card hover:shadow-md transition-shadow">
      <div className="text-3xl font-bold text-slate-900">{value}</div>
      <div className="text-sm text-slate-500">{title}</div>
    </Link>
  );
}
