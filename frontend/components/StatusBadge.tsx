import { clsx } from 'clsx';
import type { InterviewStatus } from '@/lib/types';

const STYLES: Record<InterviewStatus, string> = {
  pendiente: 'bg-slate-100 text-slate-700',
  agendada: 'bg-blue-100 text-blue-800',
  en_curso: 'bg-yellow-100 text-yellow-800',
  completada: 'bg-green-100 text-green-800',
  cancelada: 'bg-red-100 text-red-700',
  error: 'bg-red-100 text-red-700',
};

const LABELS: Record<InterviewStatus, string> = {
  pendiente: 'Pendiente',
  agendada: 'Agendada',
  en_curso: 'En curso',
  completada: 'Completada',
  cancelada: 'Cancelada',
  error: 'Error',
};

export function StatusBadge({ status }: { status: InterviewStatus }) {
  return <span className={clsx('badge', STYLES[status])}>{LABELS[status]}</span>;
}

export function RecommendationBadge({
  rec,
}: {
  rec: 'avanzar' | 'segunda_instancia' | 'descartar';
}) {
  const map = {
    avanzar: { label: 'Avanzar', cls: 'bg-green-100 text-green-800' },
    segunda_instancia: { label: 'Segunda instancia', cls: 'bg-yellow-100 text-yellow-800' },
    descartar: { label: 'Descartar', cls: 'bg-red-100 text-red-700' },
  };
  const { label, cls } = map[rec];
  return <span className={clsx('badge', cls)}>{label}</span>;
}
