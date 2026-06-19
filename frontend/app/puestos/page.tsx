'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Layout } from '@/components/Layout';
import { apiListJobs, apiDeleteJob } from '@/lib/api';
import type { Job } from '@/lib/types';

export default function PuestosPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setJobs(await apiListJobs());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onDelete(id: string) {
    if (!confirm('¿Eliminar este puesto y sus entrevistas asociadas?')) return;
    await apiDeleteJob(id);
    load();
  }

  return (
    <Layout>
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Puestos</h1>
          <p className="text-slate-600 mt-1">Cada puesto se genera a partir de un link de oferta.</p>
        </div>
        <Link href="/puestos/nuevo" className="btn-primary">+ Puesto desde link</Link>
      </header>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading ? (
        <div className="text-slate-500">Cargando...</div>
      ) : jobs.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-slate-600 mb-4">Todavía no tenés puestos cargados.</p>
          <Link href="/puestos/nuevo" className="btn-primary">Crear el primer puesto</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {jobs.map((j) => (
            <div key={j.id} className="card">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{j.title}</h2>
                  <p className="text-sm text-slate-500">{j.company}</p>
                </div>
                <span className="badge bg-slate-100 text-slate-700 uppercase text-[10px]">
                  {j.requirements.seniority}
                </span>
              </div>
              <p className="text-sm text-slate-600 mb-3 line-clamp-3">{j.description}</p>
              <div className="flex flex-wrap gap-1 mb-4">
                {j.requirements.stack.slice(0, 6).map((s) => (
                  <span key={s} className="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded">
                    {s}
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{j.preferences.durationMinutes} min · {j.preferences.toneOfVoice}</span>
                <div className="flex gap-2">
                  <Link href={`/puestos/${j.id}`} className="text-primary-600 hover:underline">
                    Ver
                  </Link>
                  <button onClick={() => onDelete(j.id)} className="text-red-600 hover:underline">
                    Borrar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
