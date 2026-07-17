import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';
import type { Candidate, Interview, Job, Report2Payload } from '../../models/types';

interface Ranked {
  interview: Interview;
  job?: Job;
  candidate?: Candidate;
  scoreTotal?: number;
  recomendacion?: 'avanzar' | 'segunda_instancia' | 'descartar';
}

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  health: any = null;
  candidates: Candidate[] = [];
  interviews: Interview[] = [];
  jobs: Job[] = [];
  ranking: Ranked[] = [];
  loading = true;
  error: string | null = null;

  constructor(private api: ApiService) {}

  async ngOnInit() {
    try {
      const [h, c, i, j] = await Promise.all([
        this.api.apiHealth(),
        this.api.apiListCandidates(),
        this.api.apiListInterviews(),
        this.api.apiListJobs(),
      ]);
      this.health = h;
      this.candidates = c;
      this.interviews = i;
      this.jobs = j;

      const completed = i.filter(iv => iv.status === 'completada').slice(0, 20);
      const r2s = await Promise.all(
        completed.map(async iv => {
          try {
            const r = await this.api.apiGetReport(iv.id, 2);
            return { iv, payload: r.report.payload as Report2Payload };
          } catch { return null; }
        })
      );
      this.ranking = r2s
        .filter(Boolean)
        .map((x: any) => ({
          interview: x.iv,
          job: j.find((jj: Job) => jj.id === x.iv.jobId),
          candidate: c.find((cc: Candidate) => cc.id === x.iv.candidateId),
          scoreTotal: x.payload.scoreTotal,
          recomendacion: x.payload.recomendacion,
        }))
        .sort((a, b) => (b.scoreTotal ?? 0) - (a.scoreTotal ?? 0));
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.loading = false;
    }
  }

  isReal(value: string): boolean {
    return value !== 'mock' && value !== 'memory';
  }

  formatDate(d: string): string {
    return new Date(d).toLocaleDateString('es-AR');
  }

  candidateName(candidateId: string): string {
    return this.candidates.find(c => c.id === candidateId)?.name ?? '—';
  }

  jobTitle(jobId: string): string {
    return this.jobs.find(j => j.id === jobId)?.title ?? '—';
  }
}
