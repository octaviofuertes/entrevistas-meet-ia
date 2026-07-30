import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type {
  Job, Company, CompanyType, Candidate,
  Interview, InterviewDetail, Report, ReportKind,
  Evaluation, InterviewTurn, TranscriptFragment, TTSDriver,
  JobQuestion, Application, ApplicationWithCandidate,
} from '../models/types';

// Vacío a propósito: las rutas quedan relativas ('/api/...') y las sirve el
// dev-server de Angular vía proxy.conf.json → backend :4000. Mismo origen que
// :4200, así que no hay CORS. No pongas la URL absoluta del backend acá.
const API_URL = '';
const TOKEN = 'admin-demo-token-cambiar';

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  private headers(): HttpHeaders {
    return new HttpHeaders({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    });
  }

  private get<T>(path: string): Promise<T> {
    return firstValueFrom(
      this.http.get<T>(`${API_URL}${path}`, { headers: this.headers() })
    );
  }

  private post<T>(path: string, body?: unknown): Promise<T> {
    return firstValueFrom(
      this.http.post<T>(`${API_URL}${path}`, body ?? null, { headers: this.headers() })
    );
  }

  private put<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(
      this.http.put<T>(`${API_URL}${path}`, body, { headers: this.headers() })
    );
  }

  private patch<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(
      this.http.patch<T>(`${API_URL}${path}`, body, { headers: this.headers() })
    );
  }

  private delete<T>(path: string): Promise<T> {
    return firstValueFrom(
      this.http.delete<T>(`${API_URL}${path}`, { headers: this.headers() })
    );
  }

  // ── Health ──────────────────────────────────────────────────────────────────
  apiHealth() {
    return this.get<{
      status: string;
      drivers: { database: string; leia: string; recall: string; tts: string };
      demoMode: boolean;
      version: string;
    }>('/api/health');
  }

  // ── Companies ───────────────────────────────────────────────────────────────
  apiListCompanies(): Promise<Company[]> {
    return this.get<{ data: Company[] }>('/api/companies').then(r => r.data);
  }

  apiGetCompany(id: string): Promise<Company> {
    return this.get<Company>(`/api/companies/${id}`);
  }

  apiCreateCompany(data: {
    name: string; logoUrl?: string | null; country?: string | null;
    cuit?: string | null; mission?: string | null; vision?: string | null;
    type?: CompanyType | null;
  }): Promise<Company> {
    return this.post<Company>('/api/companies', data);
  }

  apiUpdateCompany(id: string, data: Partial<{
    name: string; logoUrl: string | null; country: string | null;
    cuit: string | null; mission: string | null; vision: string | null;
    type: CompanyType | null;
  }>): Promise<Company> {
    return this.patch<Company>(`/api/companies/${id}`, data);
  }

  apiDeleteCompany(id: string): Promise<void> {
    return this.delete<void>(`/api/companies/${id}`);
  }

  // ── Jobs ────────────────────────────────────────────────────────────────────
  apiListJobs(): Promise<Job[]> {
    return this.get<{ data: Job[] }>('/api/jobs').then(r => r.data);
  }

  apiGetJob(id: string): Promise<Job & { interviews: Interview[] }> {
    return this.get<Job & { interviews: Interview[] }>(`/api/jobs/${id}`);
  }

  apiCreateJobFromForm(data: {
    title: string; company?: string; companyId?: string | null;
    description: string; knowledge: string; location?: string; salary?: string;
    modality?: Job['modality']; vacancies?: number; hiringStatus?: Job['hiringStatus'];
    publishedAt?: string; language?: string;
    preferences?: Partial<Job['preferences']>;
  }): Promise<Job> {
    return this.post<Job>('/api/jobs/from-form', data);
  }

  // ---- RF-02: banco de preguntas generado por IA ----
  apiGetJobQuestions(jobId: string): Promise<JobQuestion[]> {
    return this.get<{ data: JobQuestion[] }>(`/api/jobs/${jobId}/questions`).then(r => r.data);
  }

  /** Reemplaza el banco completo: sirve para editar, eliminar y reordenar. */
  apiSaveJobQuestions(jobId: string, questions: JobQuestion[]): Promise<JobQuestion[]> {
    return this.put<{ data: JobQuestion[] }>(`/api/jobs/${jobId}/questions`, { questions }).then(r => r.data);
  }

  apiRegenerateJobQuestions(jobId: string): Promise<JobQuestion[]> {
    return this.post<{ data: JobQuestion[] }>(`/api/jobs/${jobId}/questions/regenerate`, {}).then(r => r.data);
  }

  // ---- RF-01/RF-03/RF-04: postulaciones (CV → candidato + match) ----
  apiListApplications(jobId: string): Promise<ApplicationWithCandidate[]> {
    return this.get<{ data: ApplicationWithCandidate[] }>(`/api/jobs/${jobId}/applications`).then(r => r.data);
  }

  /** Sube un CV (PDF/DOCX) al puesto: alta automática del candidato + match. */
  apiUploadCvToJob(
    jobId: string,
    file: File
  ): Promise<{ candidate: Candidate; application: Application }> {
    const headers = new HttpHeaders({
      'Content-Type': file.type || 'application/octet-stream',
      Authorization: `Bearer ${TOKEN}`,
      'x-file-name': file.name,
    });
    return firstValueFrom(
      this.http.post<{ candidate: Candidate; application: Application }>(
        `${API_URL}/api/jobs/${jobId}/applications`,
        file,
        { headers }
      )
    );
  }

  apiDeleteApplication(jobId: string, applicationId: string): Promise<void> {
    return this.delete<void>(`/api/jobs/${jobId}/applications/${applicationId}`);
  }

  apiDeleteJob(id: string): Promise<void> {
    return this.delete<void>(`/api/jobs/${id}`);
  }

  // ── Candidates ──────────────────────────────────────────────────────────────
  // El alta de candidatos ocurre por apiUploadCvToJob (RF-01/RF-03): el CV se
  // sube a la vacante y leIA crea el perfil. No hay carga manual.
  apiListCandidates(): Promise<Candidate[]> {
    return this.get<{ data: Candidate[] }>('/api/candidates').then(r => r.data);
  }

  apiGetCandidate(id: string): Promise<Candidate> {
    return this.get<Candidate>(`/api/candidates/${id}`);
  }

  apiDeleteCandidate(id: string): Promise<void> {
    return this.delete<void>(`/api/candidates/${id}`);
  }

  apiUploadCandidateCv(id: string, file: File): Promise<Candidate> {
    const headers = new HttpHeaders({
      'Content-Type': 'application/pdf',
      Authorization: `Bearer ${TOKEN}`,
      'x-file-name': file.name,
    });
    return firstValueFrom(
      this.http.post<Candidate>(`${API_URL}/api/candidates/${id}/cv`, file, { headers })
    );
  }

  // ── Interviews ──────────────────────────────────────────────────────────────
  apiListInterviews(filter?: { jobId?: string; candidateId?: string; status?: string }): Promise<Interview[]> {
    const p = new URLSearchParams();
    if (filter?.jobId) p.set('jobId', filter.jobId);
    if (filter?.candidateId) p.set('candidateId', filter.candidateId);
    if (filter?.status) p.set('status', filter.status);
    const qs = p.toString() ? `?${p}` : '';
    return this.get<{ data: Interview[] }>(`/api/interviews${qs}`).then(r => r.data);
  }

  apiGetInterview(id: string): Promise<InterviewDetail> {
    return this.get<InterviewDetail>(`/api/interviews/${id}`);
  }

  apiCreateInterview(data: {
    jobId: string; candidateId: string; meetUrl?: string;
    mode?: 'meet' | 'browser'; scheduledAt?: string; ttsDriver?: TTSDriver;
  }): Promise<Interview> {
    return this.post<Interview>('/api/interviews', data);
  }

  apiUpdateInterviewTTS(id: string, ttsDriver: TTSDriver): Promise<{ ok: true; interview: Interview | null }> {
    return this.patch<{ ok: true; interview: Interview | null }>(`/api/interviews/${id}/tts`, { ttsDriver });
  }

  apiStartInterview(id: string, data?: { ttsDriver?: TTSDriver }): Promise<{ ok: true; interviewId: string }> {
    return this.post<{ ok: true; interviewId: string }>(`/api/interviews/${id}/start`, data);
  }

  apiDeleteInterview(id: string): Promise<void> {
    return this.delete<void>(`/api/interviews/${id}`);
  }

  apiUploadCv(interviewId: string, file: File): Promise<{ ok: true; extracted: boolean }> {
    const headers = new HttpHeaders({ 'Content-Type': 'application/pdf' });
    return firstValueFrom(
      this.http.post<{ ok: true; extracted: boolean }>(`${API_URL}/api/sala/${interviewId}/cv`, file, { headers })
    );
  }

  // ── Reports ─────────────────────────────────────────────────────────────────
  apiGetReport(interviewId: string, kind: ReportKind): Promise<{
    report: Report;
    interview: Interview | null;
    candidate: Candidate | null;
    job: Job | null;
    evaluations: Evaluation[];
    turns: InterviewTurn[];
    transcripts: TranscriptFragment[];
  }> {
    return this.get(`/api/reports/${interviewId}/${kind}`);
  }
}
