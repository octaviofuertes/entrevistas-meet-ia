import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';
import {
  DIMENSION_LABELS,
  QUESTION_KIND_LABELS,
  RESPONSABILIDAD_LABELS,
} from '../../models/types';
import type {
  Job, Company, Interview, Candidate, JobQuestion, JobQuestionKind,
  ApplicationWithCandidate,
} from '../../models/types';

/** Estado de subida de cada CV del lote (RF-03). */
interface UploadRow {
  fileName: string;
  status: 'pendiente' | 'procesando' | 'ok' | 'error';
  detail?: string;
}

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
  readonly questionKindLabels = QUESTION_KIND_LABELS;
  readonly responsabilidadLabels = RESPONSABILIDAD_LABELS;

  // ---- RF-02: banco de preguntas ----
  questions: JobQuestion[] = [];
  editingId: string | null = null;
  editText = '';
  savingQuestions = false;
  regenerating = false;
  questionsMsg: string | null = null;

  // ---- RF-03/RF-04: postulaciones ----
  applications: ApplicationWithCandidate[] = [];
  uploads: UploadRow[] = [];
  uploading = false;
  dragOver = false;
  expandedApp: string | null = null;

  constructor(private route: ActivatedRoute, private api: ApiService) {}

  get jobId(): string {
    return this.route.snapshot.params['id'];
  }

  async ngOnInit() {
    const id = this.jobId;
    try {
      const [job, cands] = await Promise.all([
        this.api.apiGetJob(id),
        this.api.apiListCandidates(),
      ]);
      this.job = job;
      this.questions = job.questions ?? [];
      this.candidates = cands;
      if (job.companyId) {
        this.api.apiGetCompany(job.companyId).then(c => this.company = c).catch(() => {});
      }
      this.loadApplications();
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.loading = false;
    }
  }

  private async loadApplications() {
    try {
      this.applications = await this.api.apiListApplications(this.jobId);
    } catch { /* opcional */ }
  }

  // ============================================================
  // RF-02 — Ver / editar / eliminar / regenerar preguntas
  // ============================================================
  startEdit(q: JobQuestion) {
    this.editingId = q.id;
    this.editText = q.text;
  }

  cancelEdit() {
    this.editingId = null;
    this.editText = '';
  }

  async saveEdit(q: JobQuestion) {
    const text = this.editText.trim();
    if (text.length < 5) return;
    const next = this.questions.map(x => (x.id === q.id ? { ...x, text, source: 'manual' as const } : x));
    this.cancelEdit();
    await this.persistQuestions(next, 'Pregunta actualizada.');
  }

  async removeQuestion(q: JobQuestion) {
    if (!confirm('¿Eliminar esta pregunta del banco?')) return;
    await this.persistQuestions(this.questions.filter(x => x.id !== q.id), 'Pregunta eliminada.');
  }

  async addQuestion(kind: JobQuestionKind) {
    const text = prompt('Nueva pregunta:');
    if (!text || text.trim().length < 5) return;
    const nueva: JobQuestion = {
      id: crypto.randomUUID(),
      text: text.trim(),
      kind,
      source: 'manual',
    };
    await this.persistQuestions([...this.questions, nueva], 'Pregunta agregada.');
  }

  private async persistQuestions(next: JobQuestion[], msg: string) {
    this.savingQuestions = true;
    this.questionsMsg = null;
    try {
      this.questions = await this.api.apiSaveJobQuestions(this.jobId, next);
      this.questionsMsg = msg;
    } catch (e: any) {
      this.questionsMsg = `No se pudo guardar: ${e.message}`;
    } finally {
      this.savingQuestions = false;
    }
  }

  async regenerateQuestions() {
    if (!confirm('Regenerar el banco descarta las preguntas actuales. ¿Continuar?')) return;
    this.regenerating = true;
    this.questionsMsg = null;
    try {
      this.questions = await this.api.apiRegenerateJobQuestions(this.jobId);
      this.questionsMsg = `Banco regenerado: ${this.questions.length} preguntas.`;
    } catch (e: any) {
      this.questionsMsg = `No se pudo regenerar: ${e.message}`;
    } finally {
      this.regenerating = false;
    }
  }

  questionsByKind(kind: JobQuestionKind): JobQuestion[] {
    return this.questions.filter(q => q.kind === kind);
  }

  kindClass(kind: JobQuestionKind): string {
    if (kind === 'tecnica') return 'bg-primary-100 text-primary-800';
    if (kind === 'situacional') return 'bg-amber-100 text-amber-800';
    return 'bg-slate-200 text-slate-700';
  }

  // ============================================================
  // RF-03 — Carga masiva de CVs (PDF/DOCX) sobre la vacante
  // ============================================================
  onDragOver(e: DragEvent) {
    e.preventDefault();
    this.dragOver = true;
  }

  onDragLeave() {
    this.dragOver = false;
  }

  onDrop(e: DragEvent) {
    e.preventDefault();
    this.dragOver = false;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) this.uploadFiles(files);
  }

  onFilePick(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length) this.uploadFiles(files);
    input.value = '';
  }

  /** Sube el lote en paralelo: 5 CVs deben procesarse sin bloquear la UI. */
  async uploadFiles(files: File[]) {
    this.uploading = true;
    this.uploads = files.map(f => ({ fileName: f.name, status: 'procesando' as const }));

    await Promise.all(
      files.map(async (file, i) => {
        try {
          const res = await this.api.apiUploadCvToJob(this.jobId, file);
          const nombre = [res.candidate.name, res.candidate.lastName].filter(Boolean).join(' ');
          this.uploads[i] = {
            fileName: file.name,
            status: 'ok',
            detail: `${nombre} · ${res.application.matchPercent}% match`,
          };
        } catch (e: any) {
          this.uploads[i] = {
            fileName: file.name,
            status: 'error',
            detail: e?.error?.error ?? e?.message ?? 'No se pudo procesar',
          };
        }
      })
    );

    this.uploading = false;
    await this.loadApplications();
    this.api.apiListCandidates().then(c => (this.candidates = c)).catch(() => {});
  }

  // ============================================================
  // RF-04 — Presentación del match y los patrones
  // ============================================================
  toggleApp(id: string) {
    this.expandedApp = this.expandedApp === id ? null : id;
  }

  matchClass(pct: number): string {
    if (pct >= 85) return 'bg-green-100 text-green-800';
    if (pct >= 60) return 'bg-amber-100 text-amber-800';
    return 'bg-red-100 text-red-700';
  }

  barClass(pct: number): string {
    if (pct >= 85) return 'bg-green-500';
    if (pct >= 60) return 'bg-amber-400';
    return 'bg-red-400';
  }

  candidateFullName(a: ApplicationWithCandidate): string {
    const c = a.candidate;
    if (!c) return '—';
    return [c.name, c.lastName].filter(Boolean).join(' ') || '—';
  }

  async deleteApplication(a: ApplicationWithCandidate) {
    if (!confirm('¿Quitar esta postulación del puesto?')) return;
    try {
      await this.api.apiDeleteApplication(this.jobId, a.id);
      this.applications = this.applications.filter(x => x.id !== a.id);
    } catch { /* noop */ }
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
