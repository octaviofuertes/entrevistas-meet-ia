'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Layout } from '@/components/Layout';
import { apiListCandidates, apiListJobs, apiCreateInterview } from '@/lib/api';
import type { Candidate, Job } from '@/lib/types';

const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL ?? 'http://localhost:3000';

type InterviewMode = 'meet' | 'browser';

export default function NuevaEntrevistaPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const preJobId = sp.get('jobId');
  const preCandidateId = sp.get('candidateId');

  const [jobs, setJobs] = useState<Job[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [jobId, setJobId] = useState<string>('');
  const [candidateId, setCandidateId] = useState<string>('');
  const [mode, setMode] = useState<InterviewMode>('browser');
  const [meetUrl, setMeetUrl] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

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

  const salaLink = createdId ? `${FRONTEND_URL}/sala/${createdId}` : null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!jobId) return setError('Elegí un puesto');
    if (!candidateId) return setError('Elegí un candidato');
    if (mode === 'meet' && !meetUrl.startsWith('https://meet.google.com/')) {
      return setError('Ingresá un enlace válido de Google Meet (https://meet.google.com/...)');
    }

    setSubmitting(true);
    try {
      const payload = mode === 'browser'
        ? { jobId, candidateId, mode: 'browser' as const }
        : { jobId, candidateId, mode: 'meet' as const, meetUrl };
      const interview = await apiCreateInterview(payload);
      if (mode === 'browser') {
        setCreatedId(interview.id);
      } else {
        router.push(`/entrevistas/${interview.id}`);
      }
    } catch (e: any) {
      setError(e.message);
      setSubmitting(false);
    }
  }

  // Si se creó una entrevista browser → mostrar el link y opciones
  if (createdId && salaLink) {
    return (
      <Layout>
        <header className="mb-6">
          <h1 className="text-3xl font-bold text-slate-900">Sala creada</h1>
        </header>
        <div className="card max-w-2xl space-y-4">
          <p className="text-slate-700">
            Compartí este link con el candidato. Cuando se conecte, leIA iniciará la entrevista
            automáticamente.
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              className="input flex-1 font-mono text-sm bg-slate-50"
              value={salaLink}
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              className="btn-secondary shrink-0"
              onClick={() => navigator.clipboard.writeText(salaLink)}
            >
              Copiar
            </button>
          </div>
          <div className="flex gap-3 pt-2">
            <Link href={`/entrevistas/${createdId}`} className="btn-primary">
              Ver entrevista
            </Link>
            <Link href="/entrevistas" className="btn-secondary">
              Volver a entrevistas
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <header className="mb-6">
        <Link href="/entrevistas" className="text-sm text-slate-500 hover:text-slate-700">
          ← Volver
        </Link>
        <h1 className="text-3xl font-bold text-slate-900 mt-2">Agendar entrevista</h1>
        <p className="text-slate-600 mt-1">
          Elegí el modo de entrevista: sala en el browser o reunión de Google Meet.
        </p>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-6 max-w-3xl">
        {/* Modo */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-3">Modo</h2>
          <div className="grid grid-cols-2 gap-3">
            <ModeCard
              selected={mode === 'browser'}
              onClick={() => setMode('browser')}
              icon="🌐"
              title="Sala en el browser"
              desc="El candidato accede por un link. Sin Google Meet ni bots externos."
            />
            <ModeCard
              selected={mode === 'meet'}
              onClick={() => setMode('meet')}
              icon="📹"
              title="Google Meet"
              desc="leIA envía un bot a una reunión de Meet existente."
            />
          </div>
        </div>

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

        {mode === 'meet' && (
          <div className="card">
            <h2 className="text-lg font-semibold mb-3">Enlace de Google Meet</h2>
            <p className="text-sm text-slate-500 mb-2">
              Pegá aquí el link de la reunión donde se unirá leIA.
            </p>
            <input
              type="url"
              className="input w-full"
              placeholder="https://meet.google.com/abc-defg-hij"
              value={meetUrl}
              onChange={(e) => setMeetUrl(e.target.value)}
              required={mode === 'meet'}
            />
          </div>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting
              ? 'Creando…'
              : mode === 'browser'
              ? 'Crear sala'
              : 'Agendar entrevista'}
          </button>
          <Link href="/entrevistas" className="btn-secondary">Cancelar</Link>
        </div>
      </form>
    </Layout>
  );
}

function ModeCard({
  selected,
  onClick,
  icon,
  title,
  desc,
}: {
  selected: boolean;
  onClick: () => void;
  icon: string;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-4 rounded-xl border-2 transition-all ${
        selected
          ? 'border-primary-500 bg-primary-50'
          : 'border-slate-200 hover:border-slate-300 bg-white'
      }`}
    >
      <div className="text-2xl mb-1">{icon}</div>
      <div className="font-semibold text-slate-800 text-sm">{title}</div>
      <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
    </button>
  );
}
