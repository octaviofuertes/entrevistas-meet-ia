import { MATCH_WEIGHTS } from '../../types';
import type {
  Candidate,
  CandidateTimelineEntry,
  Job,
  MatchBreakdown,
  RiskPatterns,
} from '../../types';

export interface MatchResult {
  matchPercent: number;
  breakdown: MatchBreakdown;
  patterns: RiskPatterns;
  resumenEjecutivo: string;
}

/** Umbral de rotación exigido por RF-04: permanencia menor a 1 año. */
const ROTACION_MESES = 12;
/** Ventana de análisis de rotación exigida por RF-04: últimos 4 años. */
const ROTACION_VENTANA_ANIOS = 4;
/** Mínimo de puestos cortos dentro de la ventana para marcar rotación alta. */
const ROTACION_MIN_PUESTOS = 2;

/**
 * RF-04 — Motor de matching y detección de patrones.
 *
 * El porcentaje se calcula de forma DETERMINÍSTICA con la ponderación fija del
 * requerimiento (Hard Skills 40% · Experiencia 30% · Ubicación/Modalidad 15% ·
 * Educación 15%), de modo que el resultado sea reproducible y auditable — no
 * queda librado a la variabilidad del LLM.
 */
export function computeMatch(job: Job, candidate: Candidate): MatchResult {
  const profile = candidate.profile ?? null;
  const stack = job.requirements.stack ?? [];

  // Universo de skills del candidato: ficha parseada + texto crudo del CV.
  const haystack = [
    ...(profile?.herramientas ?? []),
    ...(profile?.conocimientos ?? []),
    candidate.cvText ?? '',
  ]
    .join(' \n ')
    .toLowerCase();

  // ---- Hard Skills (40%) ----
  const gaps: string[] = [];
  let matchedSkills = 0;
  for (const tech of stack) {
    if (hasSkill(haystack, tech)) matchedSkills++;
    else gaps.push(tech);
  }
  const hardSkills = stack.length === 0 ? 1 : matchedSkills / stack.length;

  // ---- Años de experiencia exigidos (30%) ----
  const required = Math.max(0, job.requirements.yearsOfExperience ?? 0);
  const relevante = profile?.experienciaRelevanteAnios ?? profile?.experienciaTotalAnios ?? 0;
  const experiencia = required === 0 ? 1 : Math.min(1, relevante / required);

  // ---- Ubicación / Modalidad (15%) ----
  const ubicacionModalidad = scoreLocation(job, candidate);

  // ---- Educación (15%) ----
  const educacion = profile?.tituloAcademico ? 1 : 0.5;

  const breakdown: MatchBreakdown = {
    hardSkills: pct(hardSkills),
    experiencia: pct(experiencia),
    ubicacionModalidad: pct(ubicacionModalidad),
    educacion: pct(educacion),
  };

  // Los pesos ya son puntos porcentuales (40/30/15/15), así que el resultado
  // sale directo en % sin multiplicar por 100 (y sin drift de coma flotante).
  const matchPercent = Math.round(
    hardSkills * MATCH_WEIGHTS.hardSkills +
      experiencia * MATCH_WEIGHTS.experiencia +
      ubicacionModalidad * MATCH_WEIGHTS.ubicacionModalidad +
      educacion * MATCH_WEIGHTS.educacion
  );

  const patterns = detectPatterns(profile?.timeline ?? [], gaps);
  const resumenEjecutivo = buildResumen(job, candidate, matchPercent, breakdown, patterns, {
    matchedSkills,
    totalSkills: stack.length,
    relevante,
    required,
  });

  return { matchPercent, breakdown, patterns, resumenEjecutivo };
}

/**
 * RF-04 — Profiling de RRHH sobre la línea de tiempo laboral:
 * rotación, nivel de responsabilidad y brechas de habilidades.
 */
export function detectPatterns(timeline: CandidateTimelineEntry[], gaps: string[]): RiskPatterns {
  const limite = new Date();
  limite.setFullYear(limite.getFullYear() - ROTACION_VENTANA_ANIOS);

  const recientes = timeline.filter((e) => {
    const fin = parseFecha(e.hasta) ?? parseFecha(e.desde);
    return fin ? fin >= limite : false;
  });
  const cortos = recientes.filter((e) => e.meses > 0 && e.meses < ROTACION_MESES);
  const rotacionAlta = cortos.length >= ROTACION_MIN_PUESTOS;

  const rotacionDetalle = rotacionAlta
    ? `Alto Índice de Rotación (< 1 año por puesto): ${cortos.length} puestos de menos de 12 meses en los últimos ${ROTACION_VENTANA_ANIOS} años.`
    : recientes.length === 0
      ? 'Sin datos suficientes de trayectoria reciente para evaluar rotación.'
      : `Permanencia estable: ${cortos.length} puesto(s) de menos de 12 meses en los últimos ${ROTACION_VENTANA_ANIOS} años.`;

  // Nivel de responsabilidad
  const conLiderazgo = timeline.filter((e) => e.liderazgo);
  const rolesTexto = timeline.map((e) => e.rol.toLowerCase()).join(' ');
  const esJefatura = /(jefe|gerent|manager|head|director|l[ií]der|lead|responsable|supervisor)/.test(
    rolesTexto
  );

  let nivelResponsabilidad: RiskPatterns['nivelResponsabilidad'];
  let responsabilidadDetalle: string;
  if (timeline.length === 0) {
    nivelResponsabilidad = 'sin_datos';
    responsabilidadDetalle = 'No se pudo inferir el nivel de responsabilidad desde el CV.';
  } else if (conLiderazgo.length > 0 && esJefatura) {
    nivelResponsabilidad = 'gente_a_cargo';
    responsabilidadDetalle = `Tuvo gente a cargo o rol de jefatura en ${conLiderazgo.length} puesto(s).`;
  } else if (conLiderazgo.length > 0 || esJefatura) {
    nivelResponsabilidad = 'lider_proyecto';
    responsabilidadDetalle = 'Ejerció liderazgo de proyectos o coordinación de equipos.';
  } else {
    nivelResponsabilidad = 'individual';
    responsabilidadDetalle = 'Trayectoria como colaborador individual, sin evidencia de gente a cargo.';
  }

  return { rotacionAlta, rotacionDetalle, nivelResponsabilidad, responsabilidadDetalle, gaps };
}

// -------------------- helpers --------------------

/** Match de skill tolerante: palabra completa, sin distinguir acentos/caso. */
function hasSkill(haystack: string, tech: string): boolean {
  const t = tech.trim().toLowerCase();
  if (!t) return false;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9+#.])${escaped}([^a-z0-9+#.]|$)`, 'i').test(haystack);
}

function scoreLocation(job: Job, candidate: Candidate): number {
  // Remoto: la ubicación no condiciona.
  if (job.modality === 'remoto') return 1;
  const jobLoc = (job.location ?? '').trim().toLowerCase();
  const candLoc = (candidate.location ?? '').trim().toLowerCase();
  if (!jobLoc || !candLoc) return 0.7; // sin datos: no penalizamos de más
  const jobTokens = tokens(jobLoc);
  const candTokens = tokens(candLoc);
  const overlap = jobTokens.filter((t) => candTokens.includes(t));
  if (overlap.length > 0) return 1;
  return job.modality === 'hibrido' ? 0.3 : 0.2;
}

function tokens(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 2);
}

/** Parsea "MM/YYYY", "YYYY", "Actualidad"/"Presente" → Date. */
function parseFecha(raw: string): Date | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/actual|presente|hoy|current/.test(s)) return new Date();
  const mm = s.match(/(\d{1,2})[\/\-](\d{4})/);
  if (mm) return new Date(parseInt(mm[2], 10), parseInt(mm[1], 10) - 1, 1);
  const yy = s.match(/(19|20)\d{2}/);
  if (yy) return new Date(parseInt(yy[0], 10), 0, 1);
  return null;
}

function pct(x: number): number {
  return Math.round(Math.max(0, Math.min(1, x)) * 100);
}

function buildResumen(
  job: Job,
  candidate: Candidate,
  matchPercent: number,
  breakdown: MatchBreakdown,
  patterns: RiskPatterns,
  ctx: { matchedSkills: number; totalSkills: number; relevante: number; required: number }
): string {
  const nombre = [candidate.name, candidate.lastName].filter(Boolean).join(' ') || 'El candidato';
  const partes: string[] = [];

  partes.push(
    `${nombre} alcanza un ${matchPercent}% de match para ${job.title}: cubre ${ctx.matchedSkills} de ${ctx.totalSkills || 0} tecnologías requeridas (${breakdown.hardSkills}% hard skills)`
  );
  partes.push(
    ctx.required > 0
      ? `acredita ${ctx.relevante} año(s) de experiencia relevante sobre los ${ctx.required} exigidos (${breakdown.experiencia}%)`
      : `experiencia relevante acreditada: ${ctx.relevante} año(s)`
  );
  partes.push(
    candidate.profile?.tituloAcademico
      ? `formación: ${candidate.profile.tituloAcademico}`
      : 'sin título académico declarado en el CV'
  );

  let texto = partes.join('; ') + '.';

  if (patterns.gaps.length > 0) {
    texto += ` Brechas detectadas: ${patterns.gaps.join(', ')}.`;
  }
  if (patterns.rotacionAlta) {
    texto += ` ${patterns.rotacionDetalle}`;
  }
  texto += ` ${patterns.responsabilidadDetalle}`;

  return texto;
}
