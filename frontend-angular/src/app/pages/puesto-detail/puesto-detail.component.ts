import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { DIMENSION_LABELS } from '../../models/types';
import type { Job, Company, Interview, Candidate } from '../../models/types';

@Component({
  selector: 'app-puesto-detail',
  templateUrl: './puesto-detail.component.html',
})
export class PuestoDetailComponent implements OnInit {
  job: (Job & { interviews: Interview[] }) | null = null;
  company: Company | null = null;
  candidates: Candidate[] = [];
  loading = true;
  error: string | null = null;
  readonly dimensionLabels = DIMENSION_LABELS;

  constructor(private route: ActivatedRoute, private api: ApiService) {}

  async ngOnInit() {
    const id = this.route.snapshot.params['id'];
    try {
      const [job, cands] = await Promise.all([
        this.api.apiGetJob(id),
        this.api.apiListCandidates(),
      ]);
      this.job = job;
      this.candidates = cands;
      if (job.companyId) {
        this.api.apiGetCompany(job.companyId).then(c => this.company = c).catch(() => {});
      }
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.loading = false;
    }
  }

  candidateName(candidateId: string): string {
    return this.candidates.find(c => c.id === candidateId)?.name ?? '—';
  }

  hiringStatusClass(status: string | null | undefined): string {
    if (status === 'abierto') return 'bg-green-100 text-green-700';
    if (status === 'pausado') return 'bg-yellow-100 text-yellow-700';
    return 'bg-slate-100 text-slate-600';
  }
}
