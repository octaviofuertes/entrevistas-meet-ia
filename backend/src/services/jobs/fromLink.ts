import { v4 as uuid } from 'uuid';
import { config } from '../../config';
import { logger } from '../../logger';
import type { Job, JobPreferences, JobRequirements } from '../../types';
import { ALL_DIMENSIONS } from '../../types';

/**
 * Convierte un link de oferta laboral en un Job estructurado.
 *
 * Estrategia:
 *   1. Si el link contiene metadata en query/hash (modo de demo amigable),
 *      la usamos directamente.
 *   2. Si no, intentamos un fetch + parseo heurístico del HTML (best effort).
 *   3. Si todo falla, generamos un Job sensato a partir del slug del path.
 */
export async function buildJobFromLink(link: string, overrides?: {
  preferences?: Partial<JobPreferences>;
  requirements?: Partial<JobRequirements>;
}): Promise<Job> {
  const url = new URL(link);
  const fromQuery = parseQueryHints(url);

  let html = '';
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), config.JOB_LINK_TIMEOUT_MS);
    const res = await fetch(link, { signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(to);
    if (res.ok) html = await res.text();
  } catch (err) {
    logger.warn({ err, link }, 'No se pudo bajar el HTML del link, se usa fallback heurístico');
  }

  const title = fromQuery.title ?? extractTitle(html) ?? slugToTitle(url.pathname) ?? 'Posición sin nombre';
  const company = fromQuery.company ?? extractCompany(html) ?? humanizeHost(url.host);
  const description =
    fromQuery.description ?? extractDescription(html) ?? `Oferta importada desde ${url.host}.`;

  const detectedStack = detectStack(`${title} ${description} ${html.slice(0, 8000)}`);
  const seniority = detectSeniority(`${title} ${description}`);

  const requirements: JobRequirements = {
    stack: overrides?.requirements?.stack ?? detectedStack,
    seniority: overrides?.requirements?.seniority ?? seniority,
    yearsOfExperience: overrides?.requirements?.yearsOfExperience ?? defaultYears(seniority),
    responsibilities: overrides?.requirements?.responsibilities ?? [
      'Desarrollo de features end-to-end',
      'Code review y mentoría',
      'Colaboración con producto y diseño',
    ],
    niceToHave: overrides?.requirements?.niceToHave ?? [],
    language: overrides?.requirements?.language ?? config.INTERVIEW_LANGUAGE,
  };

  const preferences: JobPreferences = {
    durationMinutes: overrides?.preferences?.durationMinutes ?? 20,
    dimensionsToCover: overrides?.preferences?.dimensionsToCover ?? ALL_DIMENSIONS,
    toneOfVoice: overrides?.preferences?.toneOfVoice ?? 'cercano',
    generateReport1: overrides?.preferences?.generateReport1 ?? true,
    generateReport2: overrides?.preferences?.generateReport2 ?? true,
  };

  const now = new Date().toISOString();
  return {
    id: uuid(),
    sourceLink: link,
    title,
    company,
    description,
    requirements,
    preferences,
    rawText: html ? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 4000) : null,
    createdAt: now,
    updatedAt: now,
  };
}

function parseQueryHints(url: URL) {
  return {
    title: url.searchParams.get('title') ?? undefined,
    company: url.searchParams.get('company') ?? undefined,
    description: url.searchParams.get('description') ?? undefined,
  };
}

function extractTitle(html: string): string | undefined {
  if (!html) return;
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (ogTitle) return decode(ogTitle[1]).trim();
  const titleTag = html.match(/<title>([^<]+)<\/title>/i);
  if (titleTag) {
    const t = decode(titleTag[1]).trim();
    return t.split(/[|·\-—]/)[0].trim();
  }
}

function extractCompany(html: string): string | undefined {
  if (!html) return;
  const ogSite = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  if (ogSite) return decode(ogSite[1]).trim();
}

function extractDescription(html: string): string | undefined {
  if (!html) return;
  const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  if (ogDesc) return decode(ogDesc[1]).trim();
  const meta = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  if (meta) return decode(meta[1]).trim();
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function slugToTitle(pathname: string): string | undefined {
  const parts = pathname.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return;
  return last
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .replace(/\.\w+$/, '');
}

function humanizeHost(host: string): string {
  return host.replace(/^www\./, '').split('.').slice(0, -1).join(' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

const KNOWN_STACK = [
  'React', 'Next.js', 'Vue', 'Angular', 'Svelte',
  'Node.js', 'TypeScript', 'JavaScript', 'Python', 'Go', 'Java', 'Kotlin', 'Rust', 'C#', '.NET',
  'PostgreSQL', 'MySQL', 'MongoDB', 'Redis',
  'Docker', 'Kubernetes', 'AWS', 'GCP', 'Azure',
  'GraphQL', 'REST', 'gRPC',
  'Tailwind', 'CSS', 'HTML',
  'Jest', 'Vitest', 'Cypress', 'Playwright',
];

function detectStack(text: string): string[] {
  const lower = text.toLowerCase();
  const found = KNOWN_STACK.filter((s) => lower.includes(s.toLowerCase()));
  if (found.length > 0) return found.slice(0, 8);
  return ['JavaScript', 'TypeScript'];
}

function detectSeniority(text: string): JobRequirements['seniority'] {
  const lower = text.toLowerCase();
  if (/lead|principal|staff|tech\s*lead/.test(lower)) return 'lead';
  if (/senior|sr\b/.test(lower)) return 'senior';
  if (/semi|ssr/.test(lower)) return 'semi';
  if (/junior|jr\b|trainee|intern/.test(lower)) return 'junior';
  return 'semi';
}

function defaultYears(s: JobRequirements['seniority']): number {
  return s === 'junior' ? 1 : s === 'semi' ? 3 : s === 'senior' ? 5 : 8;
}
