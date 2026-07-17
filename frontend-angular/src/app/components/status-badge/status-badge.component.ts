import { Component, Input } from '@angular/core';
import type { InterviewStatus } from '../../models/types';

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

const REC_MAP: Record<string, { label: string; cls: string }> = {
  avanzar: { label: 'Avanzar', cls: 'bg-green-100 text-green-800' },
  segunda_instancia: { label: 'Segunda instancia', cls: 'bg-yellow-100 text-yellow-800' },
  descartar: { label: 'Descartar', cls: 'bg-red-100 text-red-700' },
};

@Component({
  selector: 'app-status-badge',
  template: `<span class="badge {{ styleClass }}">{{ label }}</span>`,
})
export class StatusBadgeComponent {
  @Input() status!: InterviewStatus;
  @Input() rec?: string;

  get styleClass(): string {
    if (this.rec) return REC_MAP[this.rec]?.cls ?? '';
    return STYLES[this.status] ?? '';
  }

  get label(): string {
    if (this.rec) return REC_MAP[this.rec]?.label ?? this.rec;
    return LABELS[this.status] ?? this.status;
  }
}
