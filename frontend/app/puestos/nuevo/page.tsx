'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Layout } from '@/components/Layout';
import { apiCreateJobFromLink, apiCreateJobFromForm } from '@/lib/api';
import { ALL_DIMENSIONS, DIMENSION_LABELS } from '@/lib/types';
import type { InterviewDimension, Job } from '@/lib/types';

type Tab = 'link' | 'form';

export default function NuevoPuestoPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('link');

  // ---- Compartido entre ambas pestañas (preferencias de la entrevista) ----
  const [duration, setDuration] = useState(20);
  const [tone, setTone] = useState<'formal' | 'cercano' | 'tecnico'>('cercano');
  const [dims, setDims] = useState<InterviewDimension[]>(ALL_DIMENSIONS);
  const [report1, setReport1] = useState(true);
  const [report2, setReport2] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Pestaña "Desde link" ----
  const [link, setLink] = useState('');

  // ---- Pestaña "Desde formulario" ----
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [description, setDescription] = useState('');
  const [knowledge, setKnowledge] = useState('');
  const [location, setLocation] = useState('');
  const [salary, setSalary] = useState('');
  const [modality, setModality] = useState<Job['modality']>('remoto');
  const [vacancies, setVacancies] = useState(1);
  const [hiringStatus, setHiringStatus] = useState<Job['hiringStatus']>('abierto');

  function toggleDim(d: InterviewDimension) {
    setDims((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  }

  const preferences = {
    durationMinutes: duration,
    dimensionsToCover: dims,
    toneOfVoice: tone,
    generateReport1: report1,
    generateReport2: report2,
  };

  async function onSubmitLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const job = await apiCreateJobFromLink({ link, preferences });
      router.push(`/puestos/${job.id}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitForm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const job = await apiCreateJobFromForm({
        title,
        company: company || undefined,
        description,
        knowledge,
        location: location || undefined,
        salary: salary || undefined,
        modality: modality ?? undefined,
        vacancies,
        hiringStatus: hiringStatus ?? undefined,
        preferences,
      });
      router.push(`/puestos/${job.id}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const preferencesFields = (
    <>
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
          <select className="input" value={tone} onChange={(e) => setTone(e.target.value as any)}>
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
              <input type="checkbox" checked={dims.includes(d)} onChange={() => toggleDim(d)} />
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
    </>
  );

  return (
    <Layout>
      <header className="mb-8">
        <Link href="/puestos" className="text-sm text-primary-600 hover:underline">
          ← Volver
        </Link>
        <h1 className="text-3xl font-bold text-slate-900 mt-2">Generar puesto</h1>
        <p className="text-slate-600 mt-1">
          Pegá el link de una oferta o completá el formulario. leIA estructura el stack, la seniority y
          las responsabilidades a evaluar.
        </p>
      </header>

      <div className="flex gap-2 mb-6 max-w-2xl">
        <button
          type="button"
          onClick={() => setTab('link')}
          className={tab === 'link' ? 'btn-primary' : 'btn-secondary'}
        >
          Desde link
        </button>
        <button
          type="button"
          onClick={() => setTab('form')}
          className={tab === 'form' ? 'btn-primary' : 'btn-secondary'}
        >
          Desde formulario
        </button>
      </div>

      {tab === 'link' ? (
        <form onSubmit={onSubmitLink} className="card space-y-6 max-w-2xl">
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

          {preferencesFields}

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
      ) : (
        <form onSubmit={onSubmitForm} className="card space-y-6 max-w-2xl">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Título del puesto</label>
              <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <label className="label">Empresa</label>
              <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="label">Descripción</label>
            <textarea
              className="input"
              rows={3}
              required
              minLength={10}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Conocimientos requeridos</label>
            <textarea
              className="input"
              rows={2}
              required
              placeholder="Ej: React, Node.js, PostgreSQL, testing"
              value={knowledge}
              onChange={(e) => setKnowledge(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Ubicación</label>
              <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div>
              <label className="label">Salario</label>
              <input className="input" value={salary} onChange={(e) => setSalary(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Modalidad</label>
              <select
                className="input"
                value={modality ?? 'remoto'}
                onChange={(e) => setModality(e.target.value as Job['modality'])}
              >
                <option value="remoto">Remoto</option>
                <option value="hibrido">Híbrido</option>
                <option value="presencial">Presencial</option>
              </select>
            </div>
            <div>
              <label className="label">Vacantes</label>
              <input
                className="input"
                type="number"
                min={1}
                max={99}
                value={vacancies}
                onChange={(e) => setVacancies(parseInt(e.target.value, 10) || 1)}
              />
            </div>
            <div>
              <label className="label">Estado</label>
              <select
                className="input"
                value={hiringStatus ?? 'abierto'}
                onChange={(e) => setHiringStatus(e.target.value as Job['hiringStatus'])}
              >
                <option value="abierto">Abierto</option>
                <option value="pausado">Pausado</option>
                <option value="cerrado">Cerrado</option>
              </select>
            </div>
          </div>

          {preferencesFields}

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
      )}
    </Layout>
  );
}
