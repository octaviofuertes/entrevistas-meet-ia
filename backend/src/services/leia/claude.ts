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
} from './index';
import type { DimensionScores, Report1Payload, Report2Payload } from '../../types';
import {
  LEIA_SYSTEM_PROMPT,
  LEIA_REPORT1_SYSTEM_PROMPT,
  LEIA_REPORT2_SYSTEM_PROMPT,
  buildEvaluatePrompt,
  buildReport1Prompt,
  buildReport2Prompt,
} from './prompts';
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
    const sys = `Sos leIA. Estructurá este puesto a partir del texto libre que cargó un reclutador.
Devolvé JSON ESTRICTO con esta forma exacta:
{"stack":["..."],"seniority":"junior|semi|senior|lead","yearsOfExperience":<entero>,"responsibilities":["..."],"niceToHave":["..."]}
- "stack": tecnologías concretas mencionadas o claramente implícitas (máx 8).
- "seniority": una de junior/semi/senior/lead según el texto.
- "responsibilities": 3 a 5 responsabilidades concretas.
- "niceToHave": 0 a 5 items, puede ser vacío.
No agregues texto fuera del JSON.`;
    try {
      const text = await this.callClaude({
        system: sys,
        user: `Título: ${input.title}\nDescripción: ${input.description}\nConocimientos requeridos: ${input.knowledge}`,
        maxTokens: 500,
        temperature: 0.4,
      });
      const parsed = JSON.parse(extractJSON(text));
      const seniority = ['junior', 'semi', 'senior', 'lead'].includes(parsed.seniority)
        ? parsed.seniority
        : 'semi';
      const stack = Array.isArray(parsed.stack) ? parsed.stack.map(String).slice(0, 8) : [];
      if (stack.length === 0) throw new Error('sin stack detectado');
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

  private async callClaude(opts: {
    system: string;
    user: string;
    maxTokens: number;
    temperature: number;
  }): Promise<string> {
    const res = await fetch(this.endpoint, {
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
  if (isNaN(x)) return 5;
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
    softskills: clamp10(parsed.softskills ?? avg({
      comunicacion: dimensions.comunicacion,
      tecnicos: dimensions.actitud,
      experiencia: dimensions.trabajoEquipo,
      resolucion: dimensions.actitud,
      actitud: dimensions.actitud,
      trabajoEquipo: dimensions.trabajoEquipo,
    })),
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
