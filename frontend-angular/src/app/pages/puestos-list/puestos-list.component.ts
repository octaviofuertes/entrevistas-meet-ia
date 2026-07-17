import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';
import type { Job } from '../../models/types';

@Component({
  selector: 'app-puestos-list',
  template: `
    <header class="mb-8 flex items-start justify-between">
      <div>
        <h1 class="text-3xl font-bold text-slate-900">Puestos</h1>
        <p class="text-slate-600 mt-1">Cada puesto se genera a partir de un link de oferta.</p>
      </div>
      <a routerLink="/puestos/nuevo" class="btn-primary">+ Puesto desde link</a>
    </header>

    <div *ngIf="error" class="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
      <strong>Error:</strong> {{ error }}
    </div>

    <div *ngIf="loading" class="text-slate-500">Cargando...</div>

    <div *ngIf="!loading && jobs.length === 0" class="card text-center py-12">
      <p class="text-slate-600 mb-4">Todavía no tenés puestos cargados.</p>
      <a routerLink="/puestos/nuevo" class="btn-primary">Crear el primer puesto</a>
    </div>

    <div *ngIf="!loading && jobs.length > 0" class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div *ngFor="let j of jobs" class="card">
        <div class="flex justify-between items-start mb-3">
          <div>
            <h2 class="text-lg font-semibold text-slate-900">{{ j.title }}</h2>
            <p class="text-sm text-slate-500">{{ j.company }}</p>
          </div>
          <span class="badge bg-slate-100 text-slate-700 uppercase text-[10px]">{{ j.requirements.seniority }}</span>
        </div>
        <p class="text-sm text-slate-600 mb-3 line-clamp-3">{{ j.description }}</p>
        <div class="flex flex-wrap gap-1 mb-4">
          <span *ngFor="let s of j.requirements.stack.slice(0, 6)"
            class="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded">{{ s }}</span>
        </div>
        <div class="flex items-center justify-between text-xs text-slate-500">
          <span>{{ j.preferences.durationMinutes }} min · {{ j.preferences.toneOfVoice }}</span>
          <div class="flex gap-2">
            <a [routerLink]="['/puestos', j.id]" class="text-primary-600 hover:underline">Ver</a>
            <button (click)="onDelete(j.id)" class="text-red-600 hover:underline">Borrar</button>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class PuestosListComponent implements OnInit {
  jobs: Job[] = [];
  loading = true;
  error: string | null = null;

  constructor(private api: ApiService) {}

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.loading = true;
    try {
      this.jobs = await this.api.apiListJobs();
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.loading = false;
    }
  }

  async onDelete(id: string) {
    if (!confirm('¿Eliminar este puesto y sus entrevistas asociadas?')) return;
    await this.api.apiDeleteJob(id);
    await this.load();
  }
}
