import type {
  Job,
  Candidate,
  Interview,
  InterviewDetail,
  Report,
  ReportKind,
  Evaluation,
  InterviewTurn,
  TranscriptFragment,
} from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const TOKEN = process.env.NEXT_PUBLIC_ADMIN_TOKEN || 'admin-demo-token-cambiar';

async function http<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      ...options.headers,
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    let body: any;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ---------------- Health ----------------
export const apiHealth = () =>
  http<{
    status: string;
    drivers: { database: string; leia: string; recall: string; tts: string };
    demoMode: boolean;
    version: string;
  }>('/api/health');

// ---------------- Jobs ----------------
export const apiListJobs = () =>
  http<{ data: Job[] }>('/api/jobs').then((r) => r.data);

export const apiGetJob = (id: string) =>
  http<Job & { interviews: Interview[] }>(`/api/jobs/${id}`);

export const apiCreateJobFromLink = (data: {
  link: string;
  preferences?: Partial<Job['preferences']>;
  requirements?: Partial<Job['requirements']>;
}) =>
  http<Job>('/api/jobs/from-link', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const apiDeleteJob = (id: string) =>
  http<void>(`/api/jobs/${id}`, { method: 'DELETE' });

// ---------------- Candidates ----------------
export const apiListCandidates = () =>
  http<{ data: Candidate[] }>('/api/candidates').then((r) => r.data);

export const apiGetCandidate = (id: string) =>
  http<Candidate>(`/api/candidates/${id}`);

export const apiCreateCandidate = (data: {
  email: string;
  name: string;
  phone?: string;
  cvUrl?: string;
  notes?: string;
}) =>
  http<Candidate>('/api/candidates', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const apiDeleteCandidate = (id: string) =>
  http<void>(`/api/candidates/${id}`, { method: 'DELETE' });

// ---------------- Interviews ----------------
export const apiListInterviews = (filter?: { jobId?: string; candidateId?: string; status?: string }) => {
  const p = new URLSearchParams();
  if (filter?.jobId) p.set('jobId', filter.jobId);
  if (filter?.candidateId) p.set('candidateId', filter.candidateId);
  if (filter?.status) p.set('status', filter.status);
  const qs = p.toString() ? `?${p}` : '';
  return http<{ data: Interview[] }>(`/api/interviews${qs}`).then((r) => r.data);
};

export const apiGetInterview = (id: string) =>
  http<InterviewDetail>(`/api/interviews/${id}`);

export const apiCreateInterview = (data: {
  jobId: string;
  candidateId: string;
  meetUrl: string;
  scheduledAt?: string;
}) =>
  http<Interview>('/api/interviews', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const apiStartInterview = (id: string) =>
  http<{ ok: true; interviewId: string }>(`/api/interviews/${id}/start`, { method: 'POST' });

export const apiFinalizeInterview = (id: string, behavior?: unknown) =>
  http<{ ok: true; reports: { report1?: Report; report2?: Report } }>(
    `/api/interviews/${id}/finalize`,
    {
      method: 'POST',
      body: behavior ? JSON.stringify({ behavior }) : undefined,
    }
  );

export const apiSimulateAnswer = (id: string, text: string) =>
  http<{ ok: true }>(`/api/interviews/${id}/simulate-answer`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });

export const apiDeleteInterview = (id: string) =>
  http<void>(`/api/interviews/${id}`, { method: 'DELETE' });

// ---------------- Reports ----------------
export const apiGetReport = (interviewId: string, kind: ReportKind) =>
  http<{
    report: Report;
    interview: Interview | null;
    candidate: Candidate | null;
    job: Job | null;
    evaluations: Evaluation[];
    turns: InterviewTurn[];
    transcripts: TranscriptFragment[];
  }>(`/api/reports/${interviewId}/${kind}`);
