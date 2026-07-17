import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { ALL_DIMENSIONS, DIMENSION_LABELS } from '../../models/types';
import type { Report1Payload, Report2Payload, Candidate, Job, Interview } from '../../models/types';

const EXPECTED_BY_SENIORITY: Record<string, number> = {
  junior: 5, semi: 6, senior: 7.5, lead: 8.5,
};

@Component({
  selector: 'app-informe',
  templateUrl: './informe.component.html',
})
export class InformeComponent implements OnInit {
  r1: Report1Payload | null = null;
  r2: Report2Payload | null = null;
  meta: { candidate?: Candidate | null; job?: Job | null; interview?: Interview | null } = {};
  createdAt: string | null = null;
  loading = true;
  error: string | null = null;
  showTranscript = false;

  readonly allDimensions = ALL_DIMENSIONS;
  readonly dimensionLabels = DIMENSION_LABELS;

  constructor(private route: ActivatedRoute, private api: ApiService) {}

  get interviewId(): string {
    return this.route.snapshot.params['id'];
  }

  get seniority(): string {
    return this.meta.job?.requirements?.seniority ?? 'semi';
  }

  get expected(): number {
    return EXPECTED_BY_SENIORITY[this.seniority] ?? 6;
  }

  get radarAxes(): string[] {
    return ALL_DIMENSIONS.map(d => DIMENSION_LABELS[d]);
  }

  get radarSeries() {
    if (!this.r2) return [];
    return [
      {
        name: 'Candidato',
        color: '#6366f1',
        fill: 'rgba(99,102,241,0.18)',
        values: ALL_DIMENSIONS.map(d => this.r2!.dimensions[d] ?? 0),
      },
      {
        name: `Esperado (${this.seniority})`,
        color: '#22c55e',
        fill: 'rgba(34,197,94,0.10)',
        values: ALL_DIMENSIONS.map(() => this.expected),
      },
    ];
  }

  get summary(): string {
    return this.r2?.executiveSummary || this.r1?.summary || '';
  }

  get behavioral(): string[] {
    return this.r2?.behavioralObservations ?? this.r1?.behavioralObservations ?? [];
  }

  get donutSentiment() {
    return [
      { label: 'Positivo', value: this.r2?.sentimentDistribution?.positive ?? 0, color: '#22c55e', face: 'happy' as const },
      { label: 'Neutral', value: this.r2?.sentimentDistribution?.neutral ?? 0, color: '#facc15', face: 'neutral' as const },
      { label: 'Negativo', value: this.r2?.sentimentDistribution?.negative ?? 0, color: '#ef4444', face: 'sad' as const },
      { label: 'No aplica', value: this.r2?.sentimentDistribution?.notApplicable ?? 0, color: '#cbd5e1', face: 'na' as const },
    ];
  }

  get donutQuality() {
    return [
      { label: 'Excelente', value: this.r2?.qualityDistribution?.excellent ?? 0, color: '#15803d', face: 'happy' as const },
      { label: 'Bueno', value: this.r2?.qualityDistribution?.good ?? 0, color: '#4ade80', face: 'happy' as const },
      { label: 'Regular', value: this.r2?.qualityDistribution?.fair ?? 0, color: '#f59e0b', face: 'neutral' as const },
      { label: 'Pobre', value: this.r2?.qualityDistribution?.poor ?? 0, color: '#ef4444', face: 'sad' as const },
    ];
  }

  get stackEntries(): Array<[string, number]> {
    if (!this.r2) return [];
    return Object.entries(this.r2.stackScores);
  }

  get footnote(): string {
    const n = this.r2?.turnsAnalyzed ?? 0;
    const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString('es-AR') : null);
    const start = fmt(this.meta.interview?.startedAt);
    const end = fmt(this.meta.interview?.endedAt) ?? start;
    const base = `Calculado sobre ${n} ${n === 1 ? 'respuesta' : 'respuestas'}`;
    return start ? `${base} · ${start}${end && end !== start ? ` a ${end}` : ''}` : base;
  }

  async ngOnInit() {
    const id = this.interviewId;
    try {
      const d2 = await this.api.apiGetReport(id, 2);
      this.r2 = d2.report.payload as Report2Payload;
      this.meta = { candidate: d2.candidate, job: d2.job, interview: d2.interview };
      this.createdAt = d2.report.createdAt;
      try {
        const d1 = await this.api.apiGetReport(id, 1);
        this.r1 = d1.report.payload as Report1Payload;
      } catch { /* informe 1 opcional */ }
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.loading = false;
    }
  }

  scoreBarColor(value: number): string {
    if (value >= 7) return 'bg-green-500';
    if (value >= 5) return 'bg-yellow-400';
    return 'bg-red-400';
  }

  scoreCircleColor(value: number): string {
    if (value >= 7) return '#22c55e';
    if (value >= 5) return '#f59e0b';
    return '#ef4444';
  }

  get scoreCircleDash(): string {
    const v = this.r2?.scoreTotal ?? 0;
    const circ = 2 * Math.PI * 40;
    const filled = (v / 10) * circ;
    return `${filled} ${circ - filled}`;
  }
}
