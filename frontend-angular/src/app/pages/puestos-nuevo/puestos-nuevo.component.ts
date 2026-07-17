import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { ALL_DIMENSIONS, DIMENSION_LABELS } from '../../models/types';
import type { InterviewDimension, Company } from '../../models/types';

@Component({
  selector: 'app-puestos-nuevo',
  templateUrl: './puestos-nuevo.component.html',
})
export class PuestosNuevoComponent implements OnInit {
  title = '';
  companies: Company[] = [];
  selectedCompanyId = '';
  description = '';
  knowledge = '';
  location = '';
  salary = '';
  modality: 'remoto' | 'hibrido' | 'presencial' = 'remoto';
  vacancies = 1;
  hiringStatus: 'abierto' | 'pausado' | 'cerrado' = 'abierto';
  publishedAt = '';

  duration = 20;
  tone: 'formal' | 'cercano' | 'tecnico' = 'cercano';
  dims: InterviewDimension[] = [...ALL_DIMENSIONS];
  report1 = true;
  report2 = true;

  busy = false;
  error: string | null = null;

  readonly allDimensions = ALL_DIMENSIONS;
  readonly dimensionLabels = DIMENSION_LABELS;

  constructor(private api: ApiService, private router: Router) {}

  async ngOnInit() {
    try {
      this.companies = await this.api.apiListCompanies();
    } catch { /* optional */ }
  }

  isDimSelected(d: InterviewDimension): boolean {
    return this.dims.includes(d);
  }

  toggleDim(d: InterviewDimension) {
    if (this.dims.includes(d)) {
      this.dims = this.dims.filter(x => x !== d);
    } else {
      this.dims = [...this.dims, d];
    }
  }

  async onSubmit(event: Event) {
    event.preventDefault();
    this.busy = true;
    this.error = null;
    try {
      const job = await this.api.apiCreateJobFromForm({
        title: this.title,
        companyId: this.selectedCompanyId || null,
        description: this.description,
        knowledge: this.knowledge,
        location: this.location || undefined,
        salary: this.salary || undefined,
        modality: this.modality,
        vacancies: this.vacancies,
        hiringStatus: this.hiringStatus,
        publishedAt: this.publishedAt ? new Date(this.publishedAt).toISOString() : undefined,
        preferences: {
          durationMinutes: this.duration,
          dimensionsToCover: this.dims,
          toneOfVoice: this.tone,
          generateReport1: this.report1,
          generateReport2: this.report2,
        },
      });
      this.router.navigate(['/puestos', job.id]);
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.busy = false;
    }
  }
}
