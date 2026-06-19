'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Layout } from '@/components/Layout';
import { apiCreateJobFromLink } from '@/lib/api';
import { ALL_DIMENSIONS, DIMENSION_LABELS } from '@/lib/types';
import type { InterviewDimension } from '@/lib/types';

export default function NuevoPuestoPage() {
  const router = useRouter();
  const [link, setLink] = useState('');
  const [duration, setDuration] = useState(20);
  const [tone, setTone] = useState<'formal' | 'cercano' | 'tecnico'>('cercano');
  const [dims, setDims] = useState<InterviewDimension[]>(ALL_DIMENSIONS);
  const [report1, setReport1] = useState(true);
  const [report2, setReport2] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleDim(d: InterviewDimension) {
    setDims((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const job = await apiCreateJobFromLink({
        link,
        preferences: {
          durationMinutes: duration,
          dimensionsToCover: dims,
          toneOfVoice: tone,
          generateReport1: report1,
          generateReport2: report2,
        },
      });
      router.push(`/puestos/${job.id}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout>
      <header className="mb-8">
        <Link href="/puestos" className="text-sm text-primary-600 hover:underline">
          ← Volver
        </Link>
        <h1 className="text-3xl font-bold text-slate-900 mt-2">Generar puesto desde link</h1>
        <p className="text-slate-600 mt-1">
          Pegá el link de la oferta. leIA va a extraer título, stack y descripción para preparar la entrevista.
        </p>
      </header>

      <form onSubmit={onSubmit} className="card space-y-6 max-w-2xl">
        <div>
          <label className="label">Link de la oferta</label>
          <input
            className="input"
            type="url"
            placeholder="https://linkedin.com/jobs/view/..."
            required
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <p className="text-xs text-slate-500 mt-1">
            Funciona con cualquier URL pública. Si la página no expone metadata, leIA genera el puesto
            a partir del slug del link.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Duración objetivo</label>
            <select
              className="input"
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value, 10))}
            >
              <option value={10}>10 minutos</option>
              <option value={15}>15 minutos</option>
              <option value={20}>20 minutos</option>
              <option value={30}>30 minutos</option>
              <option value={45}>45 minutos</option>
            </select>
          </div>
          <div>
            <label className="label">Tono</label>
            <select
              className="input"
              value={tone}
              onChange={(e) => setTone(e.target.value as any)}
            >
              <option value="cercano">Cercano</option>
              <option value="formal">Formal</option>
              <option value="tecnico">Técnico</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label">Dimensiones a cubrir</label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {ALL_DIMENSIONS.map((d) => (
              <label
                key={d}
                className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={dims.includes(d)}
                  onChange={() => toggleDim(d)}
                />
                {DIMENSION_LABELS[d]}
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={report1} onChange={(e) => setReport1(e.target.checked)} />
            Generar Informe 1 (transcripción + resumen)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={report2} onChange={(e) => setReport2(e.target.checked)} />
            Generar Informe 2 (evaluación + scoring)
          </label>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Generando…' : 'Generar puesto'}
          </button>
          <Link href="/puestos" className="btn-secondary">
            Cancelar
          </Link>
        </div>
      </form>
    </Layout>
  );
}
