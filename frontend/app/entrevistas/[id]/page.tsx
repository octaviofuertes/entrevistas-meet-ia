'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Layout } from '@/components/Layout';
import { StatusBadge } from '@/components/StatusBadge';
import {
  apiFinalizeInterview,
  apiGetInterview,
  apiStartInterview,
  apiUpdateInterviewTTS,
} from '@/lib/api';
import { DIMENSION_LABELS } from '@/lib/types';
import type { InterviewDetail, TTSDriver } from '@/lib/types';

const TTS_OPTIONS: Array<{ value: TTSDriver; label: string }> = [
  { value: 'gemini', label: 'Gemini TTS' },
  { value: 'edge', label: 'Microsoft TTS' },
];

function normalizeTtsDriver(value?: TTSDriver | null): TTSDriver {
  return value === 'edge' ? 'edge' : 'gemini';
}

export default function EntrevistaDetallePage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<InterviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTtsDriver, setSelectedTtsDriver] = useState<TTSDriver>('gemini');
  const [savingTts, setSavingTts] = useState(false);
  const [starting, setStarting] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const interview = await apiGetInterview(params.id);
      setData(interview);
      setSelectedTtsDriver(normalizeTtsDriver(interview.ttsDriver));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [params.id]);

  async function onStart() {
    if (!data?.meetUrl) return alert('No hay link de Meet configurado');
    window.open(data.meetUrl, '_blank');
    try {
      setStarting(true);
      await apiStartInterview(params.id, { ttsDriver: selectedTtsDriver });
      await load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setStarting(false);
    }
  }

  async function onSelectTtsDriver(ttsDriver: TTSDriver) {
    if (!data || data.status !== 'agendada' || savingTts) return;
    const previous = selectedTtsDriver;
    setSelectedTtsDriver(ttsDriver);
    setSavingTts(true);
    try {
      const res = await apiUpdateInterviewTTS(params.id, ttsDriver);
      setData((current) =>
        current ? { ...current, ttsDriver: res.interview?.ttsDriver ?? ttsDriver } : current
      );
    } catch (e: any) {
      setSelectedTtsDriver(previous);
      alert(e.message || 'No se pudo guardar la voz');
    } finally {
      setSavingTts(false);
    }
  }

  async function onFinalize() {
    if (!confirm('Cerrar la entrevista y generar los informes?')) return;
    try {
      await apiFinalizeInterview(params.id);
      await load();
    } catch (e: any) {
      alert(e.message);
    }
  }

  if (loading) return <Layout><p className="text-slate-500">Cargando...</p></Layout>;
  if (error || !data) return <Layout><p className="text-red-600">{error ?? 'No encontrada'}</p></Layout>;

  const hasR1 = data.reports.some((r) => r.kind === 1);
  const hasR2 = data.reports.some((r) => r.kind === 2);
  const canEditVoice = data.status === 'agendada';
  const selectedVoiceLabel =
    TTS_OPTIONS.find((option) => option.value === selectedTtsDriver)?.label ?? 'Gemini TTS';

  return (
    <Layout>
      <header className="mb-6">
        <Link href="/entrevistas" className="text-sm text-slate-500 hover:text-slate-700">
          {'<- Volver'}
        </Link>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mt-2">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">
              {data.candidate?.name ?? 'Entrevista'}
            </h1>
            <p className="text-slate-600 mt-1">
              {data.job?.title ?? '-'} - {data.job?.company ?? ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={data.status} />
            {(data.status === 'agendada' || data.status === 'en_curso') && (
              <button onClick={onStart} className="btn-primary" disabled={starting}>
                {starting ? 'Iniciando...' : 'Iniciar entrevista'}
              </button>
            )}
            {data.status === 'en_curso' && (
              <button onClick={load} className="btn-secondary">Refrescar</button>
            )}
            {data.status === 'en_curso' && (
              <button onClick={onFinalize} className="btn-secondary">Finalizar</button>
            )}
            {hasR1 && (
              <Link href={`/entrevistas/${data.id}/informe-1`} className="btn-secondary">
                Informe 1
              </Link>
            )}
            {hasR2 && (
              <Link href={`/entrevistas/${data.id}/informe-2`} className="btn-primary">
                Informe 2
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="card">
            <h2 className="text-lg font-semibold mb-3">Turnos pregunta/respuesta</h2>
            {data.turns.length === 0 ? (
              <p className="text-sm text-slate-500">
                Todavia no hubo turnos. Inicia la entrevista para que leIA arranque.
              </p>
            ) : (
              <div className="space-y-4">
                {data.turns.map((t) => {
                  const evalForTurn = data.evaluations.find((e) => e.turnId === t.id);
                  return (
                    <div key={t.id} className="border-l-4 border-primary-500 pl-4 py-2">
                      <div className="text-xs text-slate-500 mb-1">Turno #{t.index + 1}</div>
                      <p className="font-medium mb-2">{t.question}</p>
                      <div className="text-sm text-slate-700 italic bg-slate-50 p-2 rounded mb-1">
                        {t.answerTranscript || <em className="text-slate-400">(sin respuesta)</em>}
                      </div>
                      {evalForTurn && (
                        <div className="text-xs text-slate-500 mt-1">
                          Score: <strong>{evalForTurn.score.toFixed(1)}/10</strong> - {evalForTurn.rationale}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {data.evaluations.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold mb-3">
                Evaluaciones ({data.evaluations.length})
              </h2>
              <div className="space-y-3">
                {data.evaluations.map((e, i) => (
                  <div key={e.id} className="p-3 bg-slate-50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">Evaluacion #{i + 1}</span>
                      <span className="badge bg-primary-100 text-primary-800">
                        {e.score.toFixed(1)}/10
                      </span>
                    </div>
                    <p className="text-sm text-slate-700 mb-2">{e.rationale}</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                      {(Object.keys(e.dimensions) as Array<keyof typeof e.dimensions>).map((k) => (
                        <div key={k}>
                          <span className="text-slate-500">{DIMENSION_LABELS[k]}: </span>
                          <strong>{e.dimensions[k].toFixed(1)}</strong>
                        </div>
                      ))}
                    </div>
                    {e.flags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {e.flags.map((f) => (
                          <span key={f} className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="card">
            <h3 className="font-semibold mb-3">Detalles</h3>
            <dl className="text-sm space-y-2">
              <Row label="Puesto" value={data.job?.title ?? '-'} />
              <Row label="Empresa" value={data.job?.company ?? '-'} />
              <Row label="Candidato" value={data.candidate?.name ?? '-'} />
              <Row label="Email" value={data.candidate?.email ?? '-'} />
              <Row label="Voz" value={selectedVoiceLabel} />
              <Row label="Turnos" value={data.turns.length} />
              <Row label="Evaluaciones" value={data.evaluations.length} />
              <Row label="Creada" value={new Date(data.createdAt).toLocaleString('es-AR')} />
              {data.startedAt && <Row label="Iniciada" value={new Date(data.startedAt).toLocaleString('es-AR')} />}
              {data.endedAt && <Row label="Finalizada" value={new Date(data.endedAt).toLocaleString('es-AR')} />}
              {data.durationSec && <Row label="Duracion" value={`${Math.round(data.durationSec / 60)} min`} />}
            </dl>
          </div>

          <div className="card">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="font-semibold">Voz de leIA</h3>
              {savingTts && <span className="text-xs text-slate-500">Guardando...</span>}
            </div>
            <div
              className="grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-1"
              role="radiogroup"
              aria-label="Voz de leIA"
            >
              {TTS_OPTIONS.map((option) => {
                const active = selectedTtsDriver === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={!canEditVoice || savingTts || starting}
                    onClick={() => onSelectTtsDriver(option.value)}
                    className={[
                      'min-h-[40px] rounded-md px-3 text-sm font-medium transition-colors',
                      active
                        ? 'bg-white text-primary-700 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900',
                      !canEditVoice || savingTts || starting ? 'cursor-not-allowed opacity-70' : '',
                    ].join(' ')}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="card">
            <h3 className="font-semibold mb-2">Google Meet</h3>
            <p className="text-xs text-slate-500 mb-2">
              Recall.ai entra como bot a esta reunion y captura los captions nativos.
            </p>
            <a
              href={data.meetUrl}
              target="_blank"
              rel="noreferrer"
              className="block font-mono text-xs text-primary-600 hover:underline break-all"
            >
              {data.meetUrl}
            </a>
            {data.recallBotId && (
              <p className="mt-2 text-[10px] text-slate-500">Bot ID: {data.recallBotId}</p>
            )}
          </div>

          {data.status === 'en_curso' && (
            <div className="card bg-primary-50 border-primary-200">
              <h3 className="font-semibold mb-2">Entrevista en curso</h3>
              <p className="text-xs text-slate-600 mb-3">
                leIA esta entrevistando al candidato en Google Meet.
              </p>
              <a
                href={data.meetUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-primary w-full justify-center"
              >
                Abrir Google Meet
              </a>
            </div>
          )}
        </aside>
      </div>
    </Layout>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900 text-right break-words">{value}</dd>
    </div>
  );
}
