import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';
import type { Candidate } from '../../models/types';

@Component({
  selector: 'app-candidatos-list',
  template: `
    <header class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold text-slate-900">Candidatos</h1>
        <p class="text-slate-600 mt-1">{{ candidates.length }} candidatos registrados</p>
      </div>
      <a routerLink="/candidatos/nuevo" class="btn-primary">+ Nuevo candidato</a>
    </header>

    <div *ngIf="error" class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
      {{ error }}
    </div>

    <div class="card">
      <p *ngIf="loading" class="text-slate-500">Cargando...</p>

      <p *ngIf="!loading && candidates.length === 0" class="text-slate-500 text-sm">
        Todavía no hay candidatos.
        <a routerLink="/candidatos/nuevo" class="text-primary-600 hover:underline">Crear el primero</a>
      </p>

      <table *ngIf="!loading && candidates.length > 0" class="w-full text-sm">
        <thead class="text-slate-600 border-b border-slate-200">
          <tr>
            <th class="text-left py-2">Nombre</th>
            <th class="text-left py-2">Email</th>
            <th class="text-left py-2">Teléfono</th>
            <th class="text-left py-2">Creado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let c of candidates" class="border-b border-slate-100 hover:bg-slate-50">
            <td class="py-3 font-medium">{{ c.name }}</td>
            <td class="py-3 text-slate-700">{{ c.email }}</td>
            <td class="py-3 text-slate-700">{{ c.phone ?? '—' }}</td>
            <td class="py-3 text-slate-500">{{ c.createdAt | date:'dd/MM/yyyy' }}</td>
            <td class="py-3 text-right">
              <a [routerLink]="['/entrevistas/nueva']" [queryParams]="{candidateId: c.id}"
                class="text-primary-600 hover:underline mr-3">Agendar</a>
              <button (click)="onDelete(c.id)" class="text-red-600 hover:underline">Eliminar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `,
})
export class CandidatosListComponent implements OnInit {
  candidates: Candidate[] = [];
  loading = true;
  error: string | null = null;

  constructor(private api: ApiService) {}

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.loading = true;
    try {
      this.candidates = await this.api.apiListCandidates();
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.loading = false;
    }
  }

  async onDelete(id: string) {
    if (!confirm('¿Eliminar este candidato? Se eliminan también sus entrevistas.')) return;
    await this.api.apiDeleteCandidate(id);
    await this.load();
  }
}
