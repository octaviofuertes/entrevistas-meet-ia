import { config } from '../../config';
import { logger } from '../../logger';
import type {
  LeiaService,
  EvaluateInput,
  EvaluateOutput,
  FirstQuestionInput,
  Report1Input,
  Report2Input,
  StructureJobInput,
  StructureJobOutput,
  ScreenCvInput,
  ScreenCvOutput,
  RankCandidatesInput,
  RankCandidatesOutput,
  GenerateQuestionsInput,
  GeneratedQuestion,
  ParseCvInput,
  ParseCvOutput,
} from './index';
import type { DimensionScores, Report1Payload, Report2Payload } from '../../types';
import {
  LEIA_SYSTEM_PROMPT,
  LEIA_REPORT1_SYSTEM_PROMPT,
  LEIA_REPORT2_SYSTEM_PROMPT,
  LEIA_QUESTIONS_SYSTEM_PROMPT,
  LEIA_PARSE_CV_SYSTEM_PROMPT,
  buildEvaluatePrompt,
  buildReport1Prompt,
  buildReport2Prompt,
  buildQuestionsPrompt,
  buildParseCvPrompt,
} from './prompts';
import { normalizeGeneratedQuestions, normalizeParsedCv } from './parsing';
import { MockLeia } from './mock';

/**
 * Driver real de leIA: usa el modelo Claude de Anthropic como motor interno.
 * Si la API falla, cae al mock para no romper la entrevista en curso.
 */
export class ClaudeLeia implements LeiaService {
  private fallback = new MockLeia();
  private endpoint = 'https://api.anthropic.com/v1/messages';

  async generateFillers(input: FirstQuestionInput): Promise<string[]> {
    const sys = `Sos leIA, entrevistadora virtual argentina con 15 años de experiencia. Español rioplatense, voseo natural.

Generás las muletillas que decís EN VOZ ALTA mientras procesás la respuesta y pensás qué preguntar. No son frases de transición — son la voz pensante que se te escapa naturalmente en ese momento de silencio.

Suenan como lo que diría una persona real, no un sistema. Evitá las trampas de call center: "Entiendo", "Anotado", "Perfecto", "Te sigo" suenan a robot.

Estilo buscado: "Sí, sí...", "Claro, claro.", "Mm, a ver.", "Dale.", "Ah, ya veo.", "Mmm...", "A ver, a ver.", "Mm, bueno.", "Sí, ya.", "Mirá vos.", "Qué me contás.", "Uh, interesante.", "Hmm.", "Mm, dale.", "Ya veo.", "Claro.", "Dale, dale.", "Ah, sí."

Prohibido: evaluativas ("buenísimo", "perfecto", "excelente"), de transición ("siguiente pregunta", "pasemos a"), formales de call center ("entiendo", "anotado", "te sigo", "de acuerdo"), largas (más de 6 palabras).

Tono: ${input.job.preferences.toneOfVoice}. Devolvé JSON: {"fillers":["...","..."]} con 15 muletillas DISTINTAS de 1 a 6 palabras.`;
    try {
      const text = await this.callClaude({
        system: sys,
        user: `Puesto: ${input.job.title}. Candidato: ${input.candidateName}.`,
        maxTokens: 300,
        temperature: 0.95,
      });
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('no json');
      const parsed = JSON.parse(m[0]);
      const arr: string[] = Array.isArray(parsed.fillers) ? parsed.fillers.map(String) : [];
      const cleaned = arr
        .map((s: string) => s.trim().replace(/^["']|["']$/g, ''))
        .filter((s: string) => s.length > 2);
      if (cleaned.length < 3) throw new Error('pocas');
      return cleaned;
    } catch (err) {
      logger.warn({ err }, 'claude.generateFillers: fallback');
      return this.fallback.generateFillers(input);
    }
  }

  async generateClosing(input: FirstQuestionInput): Promise<string> {
    const sys = `Sos leIA, entrevistadora virtual. La entrevista terminó. Generás el cierre.
Saludá por el nombre, agradecé el tiempo, mencioná que va a recibir feedback. Tono ${input.job.preferences.toneOfVoice}, 2-3 oraciones.
Devolvé SOLO el texto.`;
    try {
      const text = await this.callClaude({
        system: sys,
        user: `Candidato: ${input.candidateName}. Puesto: ${input.job.title}.`,
        maxTokens: 180,
        temperature: 0.7,
      });
      return text.trim().replace(/^["']|["']$/g, '');
    } catch (err) {
      logger.warn({ err }, 'claude.generateClosing: fallback');
      return this.fallback.generateClosing(input);
    }
  }

  async structureJob(input: StructureJobInput): Promise<StructureJobOutput> {
    const sys = `Sos leIA. Estructurá este puesto a partir del texto que cargó un reclutador.
Devolvé JSON ESTRICTO con esta forma exacta:
{"stack":["..."],"seniority":"junior|semi|senior|lead","yearsOfExperience":<entero>,"responsibilities":["..."],"niceToHave":["..."]}
- "stack": herramientas, tecnologías o conocimientos específicos MENCIONADOS EXPLÍCITAMENTE en el título, descripción o conocimientos del puesto. NO inferir del rubro de la empresa. Para roles no técnicos (contadores, administrativos, RRHH, etc.) podés incluir herramientas propias del oficio (Excel, SAP, sistemas contables). Si no se menciona nada concreto, devolvé array vacío [].
- "seniority": una de junior/semi/senior/lead según el texto; si no queda claro, usá "semi".
- "responsibilities": 3 a 5 responsabilidades concretas del ROL (no de la empresa).
- "niceToHave": 0 a 5 items, puede ser [].
No agregues texto fuera del JSON.`;
    const co = input.company;
    const companyLines = co
      ? [
          co.name ? `Empresa contratante: ${co.name}` : '',
          co.country ? `País: ${co.country}` : '',
          co.type ? `Tipo de empresa: ${co.type}` : '',
          co.mission ? `Misión de la empresa (contexto, NO requisitos del candidato): ${co.mission}` : '',
          co.vision ? `Visión de la empresa (contexto): ${co.vision}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '';
    try {
      const text = await this.callClaude({
        system: sys,
        user: [
          `Título del puesto: ${input.title}`,
          `Descripción: ${input.description}`,
          `Conocimientos requeridos: ${input.knowledge}`,
          companyLines ? `\n--- Contexto de la empresa (solo para enriquecer) ---\n${companyLines}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        maxTokens: 500,
        temperature: 0.4,
      });
      const parsed = JSON.parse(extractJSON(text));
      const seniority = ['junior', 'semi', 'senior', 'lead'].includes(parsed.seniority)
        ? parsed.seniority
        : 'semi';
      const stack = Array.isArray(parsed.stack) ? parsed.stack.map(String).slice(0, 8) : [];
      return {
        stack,
        seniority,
        yearsOfExperience: Math.max(0, Math.min(40, Math.round(Number(parsed.yearsOfExperience) || 0))),
        responsibilities: Array.isArray(parsed.responsibilities)
          ? parsed.responsibilities.map(String).slice(0, 6)
          : [],
        niceToHave: Array.isArray(parsed.niceToHave) ? parsed.niceToHave.map(String).slice(0, 6) : [],
      };
    } catch (err) {
      logger.warn({ err }, 'claude.structureJob: fallback a mock');
      return this.fallback.structureJob(input);
    }
  }

  async screenCv(input: ScreenCvInput): Promise<ScreenCvOutput> {
    const reqStack = input.job.requirements.stack.join(', ') || '(no especificado)';
    const sys = `Sos leIA, especialista en selección de talento. Evaluás CVs contra los requisitos de un puesto y devolvés un análisis objetivo.

Puesto: ${input.job.title} en ${input.job.company || '(empresa no especificada)'}.
Stack requerido: ${reqStack}.
Seniority buscado: ${input.job.requirements.seniority}.
Experiencia mínima: ${input.job.requirements.yearsOfExperience} años.
Responsabilidades: ${input.job.requirements.responsibilities.slice(0, 4).join('; ') || '(no especificadas)'}.
${input.job.description ? `Descripción adicional: ${input.job.description.slice(0, 500)}` : ''}

Devolvé JSON ESTRICTO:
{"score":<0.0-10.0>,"recommendation":"contratar|entrevistar|descartar","summary":"<2-3 oraciones>","strengths":["..."],"weaknesses":["..."]}

Criterios: "contratar" ≥7.5, "entrevistar" 5-7.4, "descartar" <5.
No agregues texto fuera del JSON.`;
    try {
      const text = await this.callClaude({
        system: sys,
        user: `CV (archivo: ${input.fileName}):\n${input.cvText.slice(0, 4000)}`,
        maxTokens: 600,
        temperature: 0.3,
      });
      const parsed = JSON.parse(extractJSON(text));
      const score = Math.max(0, Math.min(10, parseFloat(parsed.score) || 0));
      const rec = ['contratar', 'entrevistar', 'descartar'].includes(parsed.recommendation)
        ? (parsed.recommendation as ScreenCvOutput['recommendation'])
        : score >= 7.5 ? 'contratar' : score >= 5 ? 'entrevistar' : 'descartar';
      return {
        score,
        recommendation: rec,
        summary: String(parsed.summary || ''),
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String).slice(0, 6) : [],
        weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses.map(String).slice(0, 6) : [],
      };
    } catch (err) {
      logger.warn({ err }, 'claude.screenCv: fallback a mock');
      return this.fallback.screenCv(input);
    }
  }

  async rankCandidates(input: RankCandidatesInput): Promise<RankCandidatesOutput> {
    const results = await Promise.all(
      input.candidates.map(async (c) => {
        try {
          const s = await this.screenCv({ job: input.job, cvText: c.cvText, fileName: c.name });
          return { candidateId: c.id, candidateName: c.name, ...s };
        } catch {
          return {
            candidateId: c.id,
            candidateName: c.name,
            score: 0,
            recommendation: 'descartar' as const,
            summary: 'No se pudo analizar el CV.',
            strengths: [],
            weaknesses: [],
          };
        }
      })
    );
    return results.sort((a, b) => b.score - a.score);
  }

  async firstQuestion(input: FirstQuestionInput): Promise<string> {
    const sys = `Sos leIA — entrevistadora virtual con personalidad propia, español rioplatense, voseo.
Generás la apertura de una entrevista para "${input.job.title}" en "${input.job.company}".
Tono: ${input.job.preferences.toneOfVoice}. Stack: ${input.job.requirements.stack.join(', ')}.
Reglas:
- Saludá por el nombre, presentate, mencioná los ${input.job.preferences.durationMinutes} min de duración.
- Cerrá con UNA pregunta abierta conectada al puesto y al stack.
- Hablás natural, no acartonada. Variá las aperturas. No uses "espero que estés bien".
- 3-4 oraciones máximo.${
      input.cvText
        ? '\n- El candidato subió su CV (viene en el mensaje). Tu apertura DEBE referenciar al menos un dato concreto del CV (empresa, tecnología o duración) — natural, sin recitarlo.'
        : ''
    }
Devolvé SOLO el texto a decir.`;
    const cvSection = input.cvText ? `\nCV del candidato (texto extraído):\n${input.cvText.slice(0, 3000)}` : '';
    try {
      const text = await this.callClaude({
        system: sys,
        user: `Candidato: ${input.candidateName}${cvSection}`,
        maxTokens: 220,
        temperature: 0.7,
      });
      return text.trim().replace(/^["']|["']$/g, '');
    } catch (err) {
      logger.warn({ err }, 'firstQuestion: fallback a mock');
      return this.fallback.firstQuestion(input);
    }
  }

  async evaluate(input: EvaluateInput): Promise<EvaluateOutput> {
    try {
      const text = await this.callClaude({
        system: LEIA_SYSTEM_PROMPT,
        user: buildEvaluatePrompt({
          job: input.job,
          candidateName: input.candidateName,
          history: input.history,
          lastQuestion: input.lastQuestion,
          lastAnswer: input.lastAnswer,
          turnIndex: input.turnIndex,
          cvText: input.cvText,
          gaps: input.gaps,
        }),
        maxTokens: 450,
        temperature: 0.6,
      });
      const parsed = parseEvaluate(text);

      const minTurns = Math.max(6, input.job.preferences.dimensionsToCover.length);
      if (input.turnIndex < minTurns) parsed.shouldFinish = false;
      const targetSec = input.job.preferences.durationMinutes * 60;
      if (input.elapsedSec >= targetSec * 0.97 || input.history.length >= 16) {
        parsed.shouldFinish = true;
      }
      return parsed;
    } catch (err) {
      logger.warn({ err }, 'evaluate: fallback a mock');
      return this.fallback.evaluate(input);
    }
  }

  async buildReport1(input: Report1Input): Promise<Report1Payload> {
    try {
      const text = await this.callClaude({
        system: LEIA_REPORT1_SYSTEM_PROMPT,
        user: buildReport1Prompt({
          job: input.job,
          candidateName: input.candidateName,
          fullTranscript: input.fullTranscript.map((t) => ({ speaker: t.speaker, text: t.text })),
          durationSec: input.durationSec,
          behavior: input.behavior ?? null,
          cvText: input.cvText,
        }),
        maxTokens: 1600,
        temperature: 0.3,
      });
      const parsed = parseReport1(text);
      return {
        summary: parsed.summary,
        highlights: parsed.highlights,
        behavioralObservations: parsed.behavioralObservations,
        behavior: input.behavior ?? null,
        fullTranscript: input.fullTranscript.map((t) => ({
          speaker: t.speaker,
          text: t.text,
          atMs: t.atMs,
        })),
        durationSec: input.durationSec,
        language: input.language,
      };
    } catch (err) {
      logger.warn({ err }, 'report1: fallback a mock');
      return this.fallback.buildReport1(input);
    }
  }

  async buildReport2(input: Report2Input): Promise<Report2Payload> {
    try {
      const text = await this.callClaude({
        system: LEIA_REPORT2_SYSTEM_PROMPT,
        user: buildReport2Prompt({
          job: input.job,
          candidateName: input.candidateName,
          evaluations: input.evaluations.map((e) => ({
            question: e.question,
            transcript: e.transcript,
            score: e.score,
            dims: e.dims,
            flags: e.flags,
          })),
          behavior: input.behavior ?? null,
          cvText: input.cvText,
        }),
        maxTokens: 1700,
        temperature: 0.3,
      });
      const r2 = parseReport2(text, input.job.requirements.stack);
      r2.behavior = input.behavior ?? null;
      return r2;
    } catch (err) {
      logger.warn({ err }, 'report2: fallback a mock');
      return this.fallback.buildReport2(input);
    }
  }

  /** RF-02 — Banco de 5 a 10 preguntas generado automáticamente al guardar el puesto. */
  async generateJobQuestions(input: GenerateQuestionsInput): Promise<GeneratedQuestion[]> {
    try {
      const text = await this.callClaude({
        system: LEIA_QUESTIONS_SYSTEM_PROMPT,
        user: buildQuestionsPrompt(input.job),
        maxTokens: 900,
        temperature: 0.6,
      });
      const parsed = JSON.parse(extractJSON(text));
      const out = normalizeGeneratedQuestions(parsed?.questions);
      if (out.length < 5) throw new Error('menos de 5 preguntas');
      return out;
    } catch (err) {
      logger.warn({ err }, 'claude.generateJobQuestions: fallback a mock');
      return this.fallback.generateJobQuestions(input);
    }
  }

  /** RF-03 — Extracción e inferencia de datos del CV (datos personales + ficha resumen). */
  async parseCv(input: ParseCvInput): Promise<ParseCvOutput> {
    try {
      const text = await this.callClaude({
        system: LEIA_PARSE_CV_SYSTEM_PROMPT,
        user: buildParseCvPrompt(input.cvText, input.fileName),
        maxTokens: 2000,
        temperature: 0.1,
      });
      return normalizeParsedCv(JSON.parse(extractJSON(text)), input.cvText);
    } catch (err) {
      logger.warn({ err }, 'claude.parseCv: fallback a mock');
      return this.fallback.parseCv(input);
    }
  }

  private async callClaude(opts: {
    system: string;
    user: string;
    maxTokens: number;
    temperature: number;
  }): Promise<string> {
    const res = await fetchWithTimeout(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.LEIA_MODEL,
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${txt.slice(0, 400)}`);
    }
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    if (!text) throw new Error('Respuesta vacía de Claude');
    return text;
  }
}

/**
 * Timeout duro por request. Sin esto, una conexión colgada deja el fetch
 * pendiente para siempre y el catch del caller nunca se dispara (sólo atrapa
 * errores lanzados, no un fetch colgado) → informe que no se genera / leIA que
 * no responde. Al abortar, se convierte en error → fallback al mock.
 */
const CLAUDE_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = CLAUDE_TIMEOUT_MS
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error(`Claude timeout (${timeoutMs}ms)`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// -------------------- Parsers --------------------
function extractJSON(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    const m = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (m) return m[1].trim();
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function clamp10(n: unknown): number {
  const x = typeof n === 'number' ? n : parseFloat(String(n));
  // Un valor ausente/ inválido NO es "promedio": vale 0. Antes devolvía 5, lo
  // que inflaba el informe cuando el candidato no daba material para puntuar.
  if (isNaN(x)) return 0;
  return Math.max(0, Math.min(10, Math.round(x * 10) / 10));
}

function parseEvaluate(text: string): EvaluateOutput {
  const parsed = JSON.parse(extractJSON(text));
  const d = parsed.evaluation?.dimensions ?? {};
  const dimensions: DimensionScores = {
    comunicacion: clamp10(d.comunicacion),
    tecnicos: clamp10(d.tecnicos),
    experiencia: clamp10(d.experiencia),
    resolucion: clamp10(d.resolucion),
    actitud: clamp10(d.actitud),
    trabajoEquipo: clamp10(d.trabajoEquipo),
  };
  return {
    evaluation: {
      score: clamp10(parsed.evaluation?.score ?? avg(dimensions)),
      dimensions,
      flags: Array.isArray(parsed.evaluation?.flags) ? parsed.evaluation.flags.map(String) : [],
      rationale: String(parsed.evaluation?.rationale ?? '').slice(0, 600),
    },
    nextQuestion: String(parsed.nextQuestion ?? '¿Podrías profundizar un poco más en lo que mencionaste?'),
    isClarification: Boolean(parsed.isClarification),
    shouldFinish: Boolean(parsed.shouldFinish),
  };
}

function parseReport1(
  text: string
): { summary: string; highlights: string[]; behavioralObservations: string[] } {
  const parsed = JSON.parse(extractJSON(text));
  return {
    summary: String(parsed.summary ?? ''),
    highlights: Array.isArray(parsed.highlights) ? parsed.highlights.slice(0, 12).map(String) : [],
    behavioralObservations: Array.isArray(parsed.behavioralObservations)
      ? parsed.behavioralObservations.slice(0, 10).map(String)
      : [],
  };
}

function parseReport2(text: string, stack: string[]): Report2Payload {
  const parsed = JSON.parse(extractJSON(text));
  const d = parsed.dimensions ?? {};
  const dimensions: DimensionScores = {
    comunicacion: clamp10(d.comunicacion),
    tecnicos: clamp10(d.tecnicos),
    experiencia: clamp10(d.experiencia),
    resolucion: clamp10(d.resolucion),
    actitud: clamp10(d.actitud),
    trabajoEquipo: clamp10(d.trabajoEquipo),
  };
  const stackScores: Record<string, number> = {};
  for (const tech of stack) {
    const raw = parsed.stackScores?.[tech] ?? parsed.stackScores?.[tech.toLowerCase()] ?? null;
    stackScores[tech] = raw != null ? clamp10(raw) : clamp10(dimensions.tecnicos);
  }
  const recom = ['avanzar', 'segunda_instancia', 'descartar'].includes(parsed.recomendacion)
    ? parsed.recomendacion
    : 'segunda_instancia';
  return {
    executiveSummary: String(parsed.executiveSummary ?? ''),
    scoreTotal: clamp10(parsed.scoreTotal ?? avg(dimensions)),
    dimensions,
    stackScores,
    softskills: clamp10(
      parsed.softskills ??
        (dimensions.comunicacion + dimensions.actitud + dimensions.trabajoEquipo) / 3
    ),
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 8).map(String) : [],
    weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses.slice(0, 8).map(String) : [],
    flags: Array.isArray(parsed.flags) ? parsed.flags.slice(0, 12).map(String) : [],
    sentimentDistribution: {
      positive: Math.max(0, Number(parsed.sentimentDistribution?.positive) || 0),
      neutral: Math.max(0, Number(parsed.sentimentDistribution?.neutral) || 0),
      negative: Math.max(0, Number(parsed.sentimentDistribution?.negative) || 0),
      notApplicable: Math.max(0, Number(parsed.sentimentDistribution?.notApplicable) || 0),
    },
    qualityDistribution: { excellent: 0, good: 0, fair: 0, poor: 0 },
    turnsAnalyzed: 0,
    behavioralObservations: Array.isArray(parsed.behavioralObservations)
      ? parsed.behavioralObservations.slice(0, 8).map(String)
      : [],
    suspectedReading: Boolean(parsed.suspectedReading),
    recomendacion: recom as Report2Payload['recomendacion'],
    recomendacionReason: String(parsed.recomendacionReason ?? ''),
  };
}

function avg(d: DimensionScores): number {
  return (
    (d.comunicacion + d.tecnicos + d.experiencia + d.resolucion + d.actitud + d.trabajoEquipo) / 6
  );
}
