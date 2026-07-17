import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';
import type { Company } from '../../models/types';

const TYPE_LABELS: Record<string, string> = { privada: 'Privada', publica: 'Pública', mixta: 'Mixta' };

@Component({
  selector: 'app-empresas-list',
  template: `
    <header class="mb-8 flex items-start justify-between">
      <div>
        <h1 class="text-3xl font-bold text-slate-900">Empresas</h1>
        <p class="text-slate-600 mt-1">Perfil de empresa para mostrar a candidatos y enriquecer el contexto de leIA.</p>
      </div>
      <a routerLink="/empresas/nueva" class="btn-primary">+ Nueva empresa</a>
    </header>

    <p *ngIf="loading" class="text-slate-500">Cargando…</p>
    <p *ngIf="error" class="text-red-600">{{ error }}</p>

    <div *ngIf="!loading && companies.length === 0" class="card text-center py-12">
      <p class="text-slate-500 mb-4">Todavía no hay empresas cargadas.</p>
      <a routerLink="/empresas/nueva" class="btn-primary">Crear primera empresa</a>
    </div>

    <div *ngIf="!loading && companies.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div *ngFor="let c of companies" class="card flex flex-col gap-3">
        <div class="flex items-center gap-3">
          <img *ngIf="c.logoUrl" [src]="c.logoUrl" [alt]="c.name"
            class="w-12 h-12 rounded-lg object-contain border border-slate-200 bg-white" />
          <div *ngIf="!c.logoUrl"
            class="w-12 h-12 rounded-lg bg-primary-50 text-primary-700 grid place-items-center text-xl font-bold shrink-0">
            {{ c.name[0].toUpperCase() }}
          </div>
          <div class="min-w-0">
            <h2 class="font-semibold text-slate-900 truncate">{{ c.name }}</h2>
            <div class="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
              <span *ngIf="c.country">{{ c.country }}</span>
              <span *ngIf="c.type" class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{{ typeLabel(c.type!) }}</span>
            </div>
          </div>
        </div>
        <p *ngIf="c.mission" class="text-sm text-slate-600 line-clamp-2">{{ c.mission }}</p>
        <div class="flex gap-2 mt-auto pt-2 border-t border-slate-100">
          <a [routerLink]="['/empresas', c.id]" class="btn-secondary text-xs flex-1 text-center">Editar</a>
          <button type="button" (click)="handleDelete(c.id, c.name)"
            class="text-xs text-red-500 hover:text-red-700 px-2">Eliminar</button>
        </div>
      </div>
    </div>
  `,
})
export class EmpresasListComponent implements OnInit {
  companies: Company[] = [];
  loading = true;
  error: string | null = null;

  constructor(private api: ApiService) {}

  async ngOnInit() {
    try {
      this.companies = await this.api.apiListCompanies();
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.loading = false;
    }
  }

  typeLabel(type: string): string {
    return TYPE_LABELS[type] ?? type;
  }

  async handleDelete(id: string, name: string) {
    if (!confirm(`¿Eliminar la empresa "${name}"? Los puestos vinculados quedarán sin empresa.`)) return;
    await this.api.apiDeleteCompany(id);
    this.companies = this.companies.filter(c => c.id !== id);
  }
}
