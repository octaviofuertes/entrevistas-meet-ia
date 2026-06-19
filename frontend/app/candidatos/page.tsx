'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Layout } from '@/components/Layout';
import { apiListCandidates, apiDeleteCandidate } from '@/lib/api';
import type { Candidate } from '@/lib/types';

export default function CandidatosPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setCandidates(await apiListCandidates());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onDelete = async (id: string) => {
    if (!confirm('¿Eliminar este candidato? Se eliminan también sus entrevistas.')) return;
    await apiDeleteCandidate(id);
    load();
  };

  return (
    <Layout>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Candidatos</h1>
          <p className="text-slate-600 mt-1">{candidates.length} candidatos registrados</p>
        </div>
        <Link href="/candidatos/nuevo" className="btn-primary">+ Nuevo candidato</Link>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
          {error}
        </div>
      )}

      <div className="card">
        {loading ? (
          <p className="text-slate-500">Cargando...</p>
        ) : candidates.length === 0 ? (
          <p className="text-slate-500 text-sm">
            Todavía no hay candidatos.{' '}
            <Link href="/candidatos/nuevo" className="text-primary-600 hover:underline">
              Crear el primero
            </Link>
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-slate-600 border-b border-slate-200">
              <tr>
                <th className="text-left py-2">Nombre</th>
                <th className="text-left py-2">Email</th>
                <th className="text-left py-2">Teléfono</th>
                <th className="text-left py-2">Creado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-3 font-medium">{c.name}</td>
                  <td className="py-3 text-slate-700">{c.email}</td>
                  <td className="py-3 text-slate-700">{c.phone ?? '—'}</td>
                  <td className="py-3 text-slate-500">
                    {new Date(c.createdAt).toLocaleDateString('es-AR')}
                  </td>
                  <td className="py-3 text-right">
                    <Link
                      href={`/entrevistas/nueva?candidateId=${c.id}`}
                      className="text-primary-600 hover:underline mr-3"
                    >
                      Agendar
                    </Link>
                    <button onClick={() => onDelete(c.id)} className="text-red-600 hover:underline">
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}
