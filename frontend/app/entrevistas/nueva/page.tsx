'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Layout } from '@/components/Layout';
import { apiListCandidates, apiListJobs, apiCreateInterview } from '@/lib/api';
import type { Candidate, Job } from '@/lib/types';

export default function NuevaEntrevistaPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const preJobId = sp.get('jobId');
  const preCandidateId = sp.get('candidateId');

  const [jobs, setJobs] = useState<Job[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [jobId, setJobId] = useState<string>('');
  const [candidateId, setCandidateId] = useState<string>('');
  const [meetUrl, setMeetUrl] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [c, j] = await Promise.all([apiListCandidates(), apiListJobs()]);
      setCandidates(c);
      setJobs(j);
      if (preJobId) setJobId(preJobId);
      else if (j[0]) setJobId(j[0].id);
      if (preCandidateId) setCandidateId(preCandidateId);
      else if (c[0]) setCandidateId(c[0].id);
    })();
  }, [preJobId, preCandidateId]);

  const selectedJob = jobs.find((j) => j.id === jobId);
  const selectedCandidate = candidates.find((c) => c.id === candidateId);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!jobId) return setError('Elegí un puesto');
    if (!candidateId) return setError('Elegí un candidato');
    if (!meetUrl.startsWith('https://meet.google.com/')) return setError('Ingresá un enlace válido de Google Meet (https://meet.google.com/...)');
    
    setSubmitting(true);
    try {
      const interview = await apiCreateInterview({ jobId, candidateId, meetUrl });
      router.push(`/entrevistas/${interview.id}`);
    } catch (e: any) {
      setError(e.message);
      setSubmitting(false);
    }
  }

  return (
    <Layout>
      <header className="mb-6">
        <Link href="/entrevistas" className="text-sm text-slate-500 hover:text-slate-700">
          ← Volver
        </Link>
        <h1 className="text-3xl font-bold text-slate-900 mt-2">Agendar entrevista</h1>
        <p className="text-slate-600 mt-1">
          leIA genera la reunión de Google Meet y el bot entrevistador se conecta apenas la inicies.
        </p>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-6 max-w-3xl">
        <div className="card">
          <h2 className="text-lg font-semibold mb-3">Puesto</h2>
          {jobs.length === 0 ? (
            <p className="text-sm text-slate-500">
              Necesitás generar un puesto primero.{' '}
              <Link href="/puestos/nuevo" className="text-primary-600 hover:underline">
                Generar puesto desde link
              </Link>
            </p>
          ) : (
            <select className="input" value={jobId} onChange={(e) => setJobId(e.target.value)}>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title} — {j.company} ({j.requirements.seniority})
                </option>
              ))}
            </select>
          )}
          {selectedJob && (
            <div className="mt-3 flex flex-wrap gap-1">
              {selectedJob.requirements.stack.slice(0, 8).map((s) => (
                <span key={s} className="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded">
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold mb-3">Candidato</h2>
          {candidates.length === 0 ? (
            <p className="text-sm text-slate-500">
              Necesitás crear un candidato primero.{' '}
              <Link href="/candidatos/nuevo" className="text-primary-600 hover:underline">
                Ir a crear candidato
              </Link>
            </p>
          ) : (
            <select
              className="input"
              value={candidateId}
              onChange={(e) => setCandidateId(e.target.value)}
            >
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.email}
                </option>
              ))}
            </select>
          )}
          {selectedCandidate && (
            <p className="mt-2 text-xs text-slate-500">{selectedCandidate.notes ?? ''}</p>
          )}
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold mb-3">Enlace de Google Meet</h2>
          <p className="text-sm text-slate-500 mb-2">
            Pegá aquí el link de la reunión de Meet donde se unirá leIA.
          </p>
          <input
            type="url"
            className="input w-full"
            placeholder="https://meet.google.com/abc-defg-hij"
            value={meetUrl}
            onChange={(e) => setMeetUrl(e.target.value)}
            required
          />
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Agendando…' : 'Agendar entrevista'}
          </button>
          <Link href="/entrevistas" className="btn-secondary">Cancelar</Link>
        </div>
      </form>
    </Layout>
  );
}
