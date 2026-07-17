import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type {
  Job, Company, CompanyType, Candidate, CandidateRanking,
  CvScreening, Interview, InterviewDetail, Report, ReportKind,
  Evaluation, InterviewTurn, TranscriptFragment, TTSDriver,
} from '../models/types';

const API_URL = 'http://localhost:4000';
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

  apiDeleteJob(id: string): Promise<void> {
    return this.delete<void>(`/api/jobs/${id}`);
  }

  apiRankCandidates(jobId: string, candidateIds: string[]): Promise<{ rankings: CandidateRanking[] }> {
    return this.post<{ rankings: CandidateRanking[] }>(`/api/jobs/${jobId}/rank-candidates`, { candidateIds });
  }

  // ── Candidates ──────────────────────────────────────────────────────────────
  apiListCandidates(): Promise<Candidate[]> {
    return this.get<{ data: Candidate[] }>('/api/candidates').then(r => r.data);
  }

  apiGetCandidate(id: string): Promise<Candidate> {
    return this.get<Candidate>(`/api/candidates/${id}`);
  }

  apiCreateCandidate(data: {
    email: string; name: string; phone?: string; cvUrl?: string; notes?: string;
  }): Promise<Candidate> {
    return this.post<Candidate>('/api/candidates', data);
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
