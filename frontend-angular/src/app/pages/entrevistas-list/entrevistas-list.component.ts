import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';
import type { Interview, Candidate, Job } from '../../models/types';

// Relativo → proxy.conf.json lo enruta al backend :4000 (mismo origen, sin CORS).
const API_URL = '';

@Component({
  selector: 'app-entrevistas-list',
  template: `
    <header class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold text-slate-900">Entrevistas</h1>
        <p class="text-slate-600 mt-1">{{ interviews.length }} entrevistas en total</p>
      </div>
      <a routerLink="/entrevistas/nueva" class="btn-primary">+ Nueva entrevista</a>
    </header>

    <p *ngIf="loading" class="text-slate-500">Cargando...</p>

    <div *ngIf="!loading && interviews.length === 0" class="card text-slate-500 text-sm">
      Todavía no hay entrevistas.
      <a routerLink="/entrevistas/nueva" class="text-primary-600 hover:underline">Crear la primera</a>
    </div>

    <div *ngIf="!loading && interviews.length > 0" class="card">
      <table class="w-full text-sm">
        <thead class="text-slate-600 border-b border-slate-200">
          <tr>
            <th class="text-left py-2">Candidato</th>
            <th class="text-left py-2">Puesto</th>
            <th class="text-left py-2">Estado</th>
            <th class="text-left py-2">Creada</th>
            <th class="text-left py-2">Grabación</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let iv of interviews" class="border-b border-slate-100 hover:bg-slate-50">
            <td class="py-3 font-medium">{{ candidateName(iv.candidateId) }}</td>
            <td class="py-3 text-slate-700">{{ jobTitle(iv.jobId) }}</td>
            <td class="py-3">
              <app-status-badge [status]="iv.status"></app-status-badge>
            </td>
            <td class="py-3 text-slate-500">{{ iv.createdAt | date:'dd/MM/yyyy' }}</td>
            <td class="py-2">
              <span *ngIf="iv.mode === 'browser' && iv.status === 'en_curso'" class="text-xs text-slate-400">Grabando...</span>
              <video *ngIf="iv.mode === 'browser' && iv.status !== 'en_curso'"
                [src]="apiUrl + '/api/sala/' + iv.id + '/recording'"
                controls preload="metadata"
                (error)="onVideoError($event)"
                style="width:160px;height:90px;border-radius:6px;background:#000;display:block"></video>
              <span *ngIf="iv.mode !== 'browser'" class="text-slate-300">—</span>
            </td>
            <td class="py-3 text-right whitespace-nowrap">
              <a [routerLink]="['/entrevistas', iv.id]" class="text-primary-600 hover:underline mr-3">Detalle</a>
              <a *ngIf="iv.status === 'en_curso' && iv.meetUrl && iv.mode !== 'browser'"
                [href]="iv.meetUrl" target="_blank" rel="noreferrer"
                class="text-green-600 hover:underline mr-3">▶ Meet</a>
              <a *ngIf="iv.status === 'completada'"
                [routerLink]="['/entrevistas', iv.id, 'informe']"
                class="text-blue-600 hover:underline mr-3">Informe 2</a>
              <button (click)="onDelete(iv.id)" class="text-red-600 hover:underline">Borrar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `,
})
export class EntrevistasListComponent implements OnInit {
  interviews: Interview[] = [];
  candidates: Candidate[] = [];
  jobs: Job[] = [];
  loading = true;
  apiUrl = API_URL;

  constructor(private api: ApiService) {}

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.loading = true;
    const [i, c, j] = await Promise.all([
      this.api.apiListInterviews(),
      this.api.apiListCandidates(),
      this.api.apiListJobs(),
    ]);
    this.interviews = i;
    this.candidates = c;
    this.jobs = j;
    this.loading = false;
  }

  candidateName(candidateId: string): string {
    return this.candidates.find(c => c.id === candidateId)?.name ?? '—';
  }

  jobTitle(jobId: string): string {
    return this.jobs.find(j => j.id === jobId)?.title ?? '—';
  }

  onVideoError(event: Event) {
    (event.target as HTMLVideoElement).style.display = 'none';
  }

  async onDelete(id: string) {
    if (!confirm('¿Eliminar esta entrevista?')) return;
    await this.api.apiDeleteInterview(id);
    await this.load();
  }
}
