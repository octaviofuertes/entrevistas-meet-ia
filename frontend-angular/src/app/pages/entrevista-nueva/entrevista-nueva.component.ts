import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import type { Candidate, Job } from '../../models/types';

const FRONTEND_URL = typeof location !== 'undefined' ? location.origin : 'http://localhost:4200';

@Component({
  selector: 'app-entrevista-nueva',
  templateUrl: './entrevista-nueva.component.html',
})
export class EntrevistaNuevaComponent implements OnInit {
  jobs: Job[] = [];
  candidates: Candidate[] = [];
  jobId = '';
  candidateId = '';
  mode: 'browser' | 'meet' = 'browser';
  meetUrl = '';
  submitting = false;
  error: string | null = null;
  createdId: string | null = null;

  constructor(
    private api: ApiService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  async ngOnInit() {
    const qp = this.route.snapshot.queryParams;
    const [c, j] = await Promise.all([this.api.apiListCandidates(), this.api.apiListJobs()]);
    this.candidates = c;
    this.jobs = j;
    this.jobId = qp['jobId'] ?? (j[0]?.id ?? '');
    this.candidateId = qp['candidateId'] ?? (c[0]?.id ?? '');
  }

  get selectedJob(): Job | undefined {
    return this.jobs.find(j => j.id === this.jobId);
  }

  get selectedCandidate(): Candidate | undefined {
    return this.candidates.find(c => c.id === this.candidateId);
  }

  get salaLink(): string {
    return `${FRONTEND_URL}/sala/${this.createdId}`;
  }

  async copyLink() {
    await navigator.clipboard.writeText(this.salaLink);
  }

  async onSubmit(event: Event) {
    event.preventDefault();
    this.error = null;
    if (!this.jobId) { this.error = 'Elegí un puesto'; return; }
    if (!this.candidateId) { this.error = 'Elegí un candidato'; return; }
    if (this.mode === 'meet' && !this.meetUrl.startsWith('https://meet.google.com/')) {
      this.error = 'Ingresá un enlace válido de Google Meet (https://meet.google.com/...)';
      return;
    }
    this.submitting = true;
    try {
      const payload = this.mode === 'browser'
        ? { jobId: this.jobId, candidateId: this.candidateId, mode: 'browser' as const }
        : { jobId: this.jobId, candidateId: this.candidateId, mode: 'meet' as const, meetUrl: this.meetUrl };
      const interview = await this.api.apiCreateInterview(payload);
      if (this.mode === 'browser') {
        this.createdId = interview.id;
      } else {
        this.router.navigate(['/entrevistas', interview.id]);
      }
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.submitting = false;
    }
  }
}
