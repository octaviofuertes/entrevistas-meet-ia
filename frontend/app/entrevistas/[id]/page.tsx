'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Layout } from '@/components/Layout';
import { StatusBadge } from '@/components/StatusBadge';
import {
  apiGetInterview,
  apiStartInterview,
  apiUpdateInterviewTTS,
} from '@/lib/api';
import { DIMENSION_LABELS } from '@/lib/types';
import type { InterviewDetail, TTSDriver } from '@/lib/types';

const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL ?? 'http://localhost:3000';

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
  const [copied, setCopied] = useState(false);

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

  const isBrowser = data?.mode === 'browser';
  const salaUrl = `${FRONTEND_URL}/sala/${params.id}`;

  async function onStart() {
    // Para modo browser: no necesitamos meetUrl — el engine arranca cuando el candidato se conecta.
    // Para modo meet: abrir Google Meet y luego iniciar el bot.
    if (!isBrowser) {
      if (!data?.meetUrl) return alert('No hay link de Meet configurado');
      window.open(data.meetUrl, '_blank');
    }
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

  async function copySalaUrl() {
    await navigator.clipboard.writeText(salaUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
            {isBrowser && data.status === 'agendada' && (
              <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1 rounded-full font-medium">
                Sala nativa
              </span>
            )}
            {(data.status === 'agendada' || data.status === 'en_curso') && !isBrowser && (
              <button onClick={onStart} className="btn-primary" disabled={starting}>
                {starting ? 'Iniciando...' : 'Iniciar entrevista'}
              </button>
            )}
            {data.status === 'en_curso' && (
              <button onClick={load} className="btn-secondary">Refrescar</button>
            )}
            {(hasR1 || hasR2) && (
              <Link href={`/entrevistas/${data.id}/informe`} className="btn-primary">
                Ver informe
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {/* Banner sala browser cuando está agendada */}
          {isBrowser && data.status === 'agendada' && (
            <div className="card bg-blue-50 border border-blue-200">
              <h2 className="font-semibold text-blue-900 mb-2">Link de la sala para el candidato</h2>
              <p className="text-sm text-blue-700 mb-3">
                Compartí este link. La entrevista empieza automáticamente cuando el candidato se conecte.
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  className="flex-1 font-mono text-sm bg-white border border-blue-200 rounded-lg px-3 py-2 text-blue-800"
                  value={salaUrl}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={copySalaUrl}
                  className="shrink-0 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  {copied ? 'Copiado ✓' : 'Copiar'}
                </button>
              </div>
              <div className="mt-3 flex gap-2">
                <a
                  href={salaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-600 hover:underline"
                >
                  Abrir sala (vista candidato) →
                </a>
              </div>
            </div>
          )}

          {/* Banner sala en curso */}
          {isBrowser && data.status === 'en_curso' && (
            <div className="card bg-green-50 border border-green-200">
              <h2 className="font-semibold text-green-900 mb-1">Sala en curso</h2>
              <p className="text-xs text-green-700 mb-3">
                leIA está entrevistando al candidato en la sala nativa.
              </p>
              <div className="flex gap-2">
                <a
                  href={salaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primary text-sm"
                >
                  Ver sala
                </a>
                <button onClick={load} className="btn-secondary text-sm">Refrescar</button>
              </div>
            </div>
          )}

          {/* Grabación de la entrevista */}
          {isBrowser && data.status !== 'agendada' && (
            <div className="card">
              <h2 className="text-lg font-semibold mb-1">Grabación</h2>
              <p className="text-xs text-slate-500 mb-3">
                Video compuesto: leIA + candidato (con audio)
              </p>
              <video
                controls
                preload="metadata"
                className="w-full rounded-lg bg-black"
                style={{ maxHeight: 480 }}
                src={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/sala/${data.id}/recording`}
                onError={e => {
                  const vid = e.currentTarget as HTMLVideoElement;
                  vid.style.display = 'none';
                  vid.nextElementSibling?.classList.remove('hidden');
                }}
              />
              <p className="hidden text-sm text-slate-500 mt-2">
                {data.status === 'en_curso'
                  ? 'Grabando… la grabación estará disponible al finalizar.'
                  : 'La grabación se sube automáticamente al terminar la sala. Si ya terminó, actualizá la página.'}
              </p>
            </div>
          )}

          <div className="card">
            <h2 className="text-lg font-semibold mb-3">Turnos pregunta/respuesta</h2>
            {data.turns.length === 0 ? (
              <p className="text-sm text-slate-500">
                {isBrowser
                  ? 'Todavía no hubo turnos. El candidato debe conectarse a la sala para que leIA arranque.'
                  : 'Todavia no hubo turnos. Inicia la entrevista para que leIA arranque.'}
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
              <Row label="Modo" value={isBrowser ? '🌐 Sala browser' : '📹 Google Meet'} />
              <Row label="Voz" value={selectedVoiceLabel} />
              <Row label="Turnos" value={data.turns.length} />
              <Row label="Evaluaciones" value={data.evaluations.length} />
              <Row label="Creada" value={new Date(data.createdAt).toLocaleString('es-AR')} />
              {data.startedAt && <Row label="Iniciada" value={new Date(data.startedAt).toLocaleString('es-AR')} />}
              {data.endedAt && <Row label="Finalizada" value={new Date(data.endedAt).toLocaleString('es-AR')} />}
              {data.durationSec != null && <Row label="Duracion" value={`${Math.round(data.durationSec / 60)} min`} />}
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

          {/* Panel Google Meet — solo para entrevistas Meet */}
          {!isBrowser && (
            <div className="card">
              <h3 className="font-semibold mb-2">Google Meet</h3>
              <p className="text-xs text-slate-500 mb-2">
                Recall.ai entra como bot a esta reunion y captura los captions nativos.
              </p>
              <a
                href={data.meetUrl || '#'}
                target="_blank"
                rel="noreferrer"
                className="block font-mono text-xs text-primary-600 hover:underline break-all"
              >
                {data.meetUrl || '—'}
              </a>
              {data.recallBotId && (
                <p className="mt-2 text-[10px] text-slate-500">Bot ID: {data.recallBotId}</p>
              )}
            </div>
          )}

          {/* Panel sala browser — sidebar */}
          {isBrowser && (
            <div className="card">
              <h3 className="font-semibold mb-2">Sala browser</h3>
              <p className="text-xs text-slate-500 mb-2">
                Sin bots externos. El candidato accede directamente por este link.
              </p>
              <button
                onClick={copySalaUrl}
                className="w-full text-left font-mono text-xs text-primary-600 hover:underline break-all"
              >
                {salaUrl}
              </button>
            </div>
          )}

          {/* En curso Meet */}
          {data.status === 'en_curso' && !isBrowser && (
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
