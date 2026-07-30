import type { GeneratedQuestion, ParseCvOutput } from './index';
import type {
  CandidateLanguage,
  CandidateProfile,
  CandidateTimelineEntry,
  JobQuestionKind,
  LanguageLevel,
} from '../../types';

const QUESTION_KINDS: JobQuestionKind[] = ['tecnica', 'situacional', 'descarte'];
const LANGUAGE_LEVELS: LanguageLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'Nativo'];

/**
 * RF-02 — Normaliza el banco de preguntas devuelto por la IA: valida el tipo,
 * limpia, deduplica y acota a 10 (el requerimiento pide entre 5 y 10).
 */
export function normalizeGeneratedQuestions(raw: unknown): GeneratedQuestion[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: GeneratedQuestion[] = [];
  for (const item of raw) {
    const text = String((item as any)?.text ?? '').trim().replace(/\s+/g, ' ');
    if (!text || text.length < 8) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    const rawKind = String((item as any)?.kind ?? '').toLowerCase() as JobQuestionKind;
    const kind: JobQuestionKind = QUESTION_KINDS.includes(rawKind) ? rawKind : 'situacional';
    seen.add(key);
    out.push({ text: text.slice(0, 300), kind });
    if (out.length >= 10) break;
  }
  return out;
}

/**
 * RF-03 — Normaliza la ficha parseada del CV. Nunca confía en la forma cruda
 * del LLM: castea tipos, acota arrays y completa email/teléfono/DNI por regex
 * sobre el texto del CV cuando el modelo no los devolvió.
 */
export function normalizeParsedCv(raw: any, cvText: string): ParseCvOutput {
  const p = raw?.personal ?? {};
  const pr = raw?.profile ?? {};

  const email = str(p.email) ?? matchEmail(cvText);
  const telefono = str(p.telefono) ?? matchPhone(cvText);
  const dni = digits(str(p.dni)) ?? matchDni(cvText);
  const fechaNacimiento = str(p.fechaNacimiento);

  const timeline = normalizeTimeline(pr.timeline);
  const experienciaTotalAnios = num(pr.experienciaTotalAnios, 0, 60);
  const experienciaRelevanteAnios = Math.min(
    num(pr.experienciaRelevanteAnios, 0, 60),
    experienciaTotalAnios || 60
  );

  const profile: CandidateProfile = {
    tituloAcademico: str(pr.tituloAcademico),
    conocimientos: strArray(pr.conocimientos, 40),
    herramientas: strArray(pr.herramientas, 60),
    idiomas: normalizeLanguages(pr.idiomas),
    timeline,
    experienciaTotalAnios,
    experienciaRelevanteAnios,
  };

  return {
    personal: {
      nombre: str(p.nombre),
      apellido: str(p.apellido),
      dni,
      fechaNacimiento,
      edad: intOrNull(p.edad, 14, 99) ?? ageFromBirthDate(fechaNacimiento),
      telefono,
      email,
      ubicacion: str(p.ubicacion),
    },
    profile,
  };
}

function normalizeTimeline(raw: unknown): CandidateTimelineEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e: any) => ({
      empresa: str(e?.empresa) ?? '',
      rol: str(e?.rol) ?? '',
      desde: str(e?.desde) ?? '',
      hasta: str(e?.hasta) ?? '',
      meses: num(e?.meses, 0, 720),
      liderazgo: Boolean(e?.liderazgo),
    }))
    .filter((e) => e.empresa || e.rol)
    .slice(0, 30);
}

function normalizeLanguages(raw: unknown): CandidateLanguage[] {
  if (!Array.isArray(raw)) return [];
  const out: CandidateLanguage[] = [];
  for (const l of raw) {
    const idioma = str((l as any)?.idioma);
    if (!idioma) continue;
    const rawLevel = String((l as any)?.nivel ?? '').trim();
    const nivel = (LANGUAGE_LEVELS.find((x) => x.toLowerCase() === rawLevel.toLowerCase()) ??
      'B1') as LanguageLevel;
    out.push({ idioma, nivel });
    if (out.length >= 10) break;
  }
  return out;
}

// -------------------- helpers --------------------
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === 'null' || s.toLowerCase() === 'n/a') return null;
  return s.slice(0, 300);
}

function digits(v: string | null): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, '');
  return d.length >= 6 ? d : null;
}

function strArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of v) {
    const s = str(item);
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function num(v: unknown, min: number, max: number): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (isNaN(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n * 10) / 10));
}

function intOrNull(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (isNaN(n)) return null;
  if (n < min || n > max) return null;
  return Math.round(n);
}

function ageFromBirthDate(d: string | null): number | null {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  const diff = Date.now() - dt.getTime();
  const age = Math.floor(diff / (365.25 * 24 * 3600 * 1000));
  return age >= 14 && age <= 99 ? age : null;
}

function matchEmail(text: string): string | null {
  const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/);
  return m ? m[0] : null;
}

function matchPhone(text: string): string | null {
  const m = text.match(/(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3}[\s-]?\d{4}/);
  if (!m) return null;
  const digitsOnly = m[0].replace(/\D/g, '');
  return digitsOnly.length >= 8 ? m[0].trim() : null;
}

function matchDni(text: string): string | null {
  const m = text.match(/\b(?:DNI|D\.N\.I\.?|Documento)\s*:?\s*([\d.]{7,12})\b/i);
  if (m) return m[1].replace(/\D/g, '');
  return null;
}
