import { Component, ElementRef, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-candidato-nuevo',
  template: `
    <header class="mb-6">
      <a routerLink="/candidatos" class="text-sm text-slate-500 hover:text-slate-700">← Volver</a>
      <h1 class="text-3xl font-bold text-slate-900 mt-2">Nuevo candidato</h1>
    </header>

    <div *ngIf="error" class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
      {{ error }}
    </div>

    <form (submit)="onSubmit($event)" class="card max-w-2xl space-y-4">
      <div>
        <label class="label">Nombre completo *</label>
        <input class="input" type="text" required [(ngModel)]="name" name="name" />
      </div>
      <div>
        <label class="label">Email *</label>
        <input class="input" type="email" required [(ngModel)]="email" name="email" />
      </div>
      <div>
        <label class="label">Teléfono</label>
        <input class="input" type="tel" [(ngModel)]="phone" name="phone" placeholder="+54 11 ..." />
      </div>
      <div>
        <label class="label">CV (PDF)</label>
        <input #cvInput type="file" accept="application/pdf" class="hidden" (change)="onCvChange($event)" />
        <div class="flex items-center gap-3">
          <button type="button" class="btn-secondary" (click)="cvInput.click()">
            {{ cvFile ? 'Cambiar archivo' : 'Seleccionar PDF' }}
          </button>
          <span *ngIf="cvFile" class="text-sm text-slate-700">{{ cvFile.name }}</span>
          <span *ngIf="!cvFile" class="text-sm text-slate-400">Ningún archivo seleccionado</span>
        </div>
      </div>
      <div>
        <label class="label">Notas internas</label>
        <textarea class="input" rows="4" [(ngModel)]="notes" name="notes"></textarea>
      </div>
      <div class="flex items-center gap-3 pt-4">
        <button type="submit" class="btn-primary" [disabled]="busy">
          {{ busy ? 'Guardando...' : 'Crear candidato' }}
        </button>
        <a routerLink="/candidatos" class="btn-secondary">Cancelar</a>
      </div>
    </form>
  `,
})
export class CandidatoNuevoComponent {
  name = '';
  email = '';
  phone = '';
  notes = '';
  cvFile: File | null = null;
  busy = false;
  error: string | null = null;

  constructor(private api: ApiService, private router: Router) {}

  onCvChange(event: Event) {
    this.cvFile = (event.target as HTMLInputElement).files?.[0] ?? null;
  }

  async onSubmit(event: Event) {
    event.preventDefault();
    this.error = null;
    this.busy = true;
    try {
      const candidate = await this.api.apiCreateCandidate({
        name: this.name,
        email: this.email,
        phone: this.phone || undefined,
        notes: this.notes || undefined,
      });
      if (this.cvFile) {
        await this.api.apiUploadCandidateCv(candidate.id, this.cvFile);
      }
      this.router.navigate(['/candidatos']);
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.busy = false;
    }
  }
}
