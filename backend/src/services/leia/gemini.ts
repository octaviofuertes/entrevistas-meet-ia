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
import { normalizeGeneratedQuestions, normalizeParsedCv } from './parsing';
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
import { MockLeia } from './mock';

/**
 * Driver temporal de leIA usando Google Generative Language (Gemini).
 *
 * leIA es la IA propia del sistema; mientras tanto, este driver permite
 * delegar la inteligencia a Gemini sin cambiar el contrato público:
 *   POST /api/leia/evaluate
 *   POST /api/leia/next-question
 *
 * Si la API falla, cae automáticamente al mock heurístico para no
 * cortar la entrevista en curso.
 */
export class GeminiLeia implements LeiaService {
  private fallback = new MockLeia();

  async generateFillers(input: FirstQuestionInput): Promise<string[]> {
    const sys = `Sos leIA — entrevistadora virtual argentina con 15 años de experiencia. Hablás español rioplatense con voseo natural.

Generás las muletillas que vas a decir en voz alta MIENTRAS PROCESÁS la respuesta del candidato y pensás qué preguntar. No son frases de transición: son la voz interna que se te escapa mientras tu cabeza trabaja.

CLAVE: tienen que sonar como lo que diría UNA PERSONA REAL en ese momento de silencio pensante — no un sistema de reconocimiento de voz acusando recibo. Evitá la trampa de las "palabras de call center" (Entiendo, Anotado, Perfecto, Te sigo) que suenan a robot.

ESTILO BUSCADO — fillers naturales de entrevistadora argentina pensando en voz alta:
"Sí, sí...", "Claro, claro.", "Dale, dale.", "Mm, a ver.", "Mmm...", "Ah, ya veo.", "Sí, ya.", "A ver, a ver.", "Mm, bueno.", "Ah, mirá.", "Sí, sí, claro.", "Mm, dale.", "Bueno, bueno.", "Ya, ya.", "Claro.", "Ah, sí.", "Mm, sí.", "A ver...", "Dale.", "Ah, bueno.", "Mm, ya.", "Uh, interesante.", "Hmm.", "Sí.", "Qué me contás.", "Ajá, sí.", "Mirá vos.", "Ah, claro.", "Mmm, dale.", "Ya veo."

PROHIBIDO (suenan a robot o a script):
- Evaluativas: "buenísimo", "perfecto", "excelente", "muy bien", "genial", "qué bueno", "fantástico", "brillante", "increíble"
- De transición o anuncio: "pasemos a", "siguiente pregunta", "vamos con", "te quería preguntar", "ahora te pregunto", "cambiemos de tema"
- Formales de call center: "entiendo", "anotado", "anotando", "te sigo", "de acuerdo", "por supuesto"
- Largas (más de 6 palabras)

Tono: ${input.job.preferences.toneOfVoice}. Devolvé JSON con esta forma exacta: {"fillers":["...", "..."]} — 20 muletillas DISTINTAS, cada una de 1 a 6 palabras. Solo texto hablado, sin puntuación extra.`;
    try {
      const text = await this.callGemini({
        system: sys,
        user: `Puesto: ${input.job.title} en ${input.job.company}. Candidato: ${input.candidateName}.`,
        maxTokens: 300,
        temperature: 0.95,
        json: true,
      });
      const parsed = JSON.parse(extractJSON(text));
      const arr: string[] = Array.isArray(parsed.fillers) ? parsed.fillers.map(String) : [];
      const cleaned = arr
        .map((s: string) => s.trim().replace(/^["']|["']$/g, ''))
        .filter((s: string) => s.length > 2 && s.length < 100);
      if (cleaned.length < 3) throw new Error('pocas muletillas');
      return cleaned;
    } catch (err) {
      logger.warn({ err }, 'gemini.generateFillers: fallback a mock');
      return this.fallback.generateFillers(input);
    }
  }

  async generateClosing(input: FirstQuestionInput): Promise<string> {
    const sys = `Sos leIA — entrevistadora virtual, español rioplatense, voseo.
La entrevista terminó. Generás el cierre que vas a decir en voz alta.
Reglas:
- Dirigite al candidato por su nombre.
- Agradecé brevemente el tiempo.
- Mencioná que va a recibir feedback pronto (sin prometer ningún resultado).
- Tono ${input.job.preferences.toneOfVoice}, natural, 2-3 oraciones.
- No uses "espero que estés bien" ni "que tengas un excelente día".
Devolvé SOLO el texto a decir, sin comillas ni metadatos.`;
    try {
      const text = await this.callGemini({
        system: sys,
        user: `Candidato: ${input.candidateName}. Puesto: ${input.job.title} en ${input.job.company}.`,
        maxTokens: 180,
        temperature: 0.7,
      });
      return text.trim().replace(/^["']|["']$/g, '');
    } catch (err) {
      logger.warn({ err }, 'gemini.generateClosing: fallback a mock');
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
      const text = await this.callGemini({
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
        json: true,
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
      logger.warn({ err }, 'gemini.structureJob: fallback a mock');
      return this.fallback.structureJob(input);
    }
  }

  /** RF-02 — Banco de 5 a 10 preguntas generado automáticamente al guardar el puesto. */
  async generateJobQuestions(input: GenerateQuestionsInput): Promise<GeneratedQuestion[]> {
    try {
      const text = await this.callGemini({
        system: LEIA_QUESTIONS_SYSTEM_PROMPT,
        user: buildQuestionsPrompt(input.job),
        maxTokens: 900,
        temperature: 0.6,
        json: true,
      });
      const parsed = JSON.parse(extractJSON(text));
      const out = normalizeGeneratedQuestions(parsed?.questions);
      if (out.length < 5) throw new Error('menos de 5 preguntas');
      return out;
    } catch (err) {
      logger.warn({ err }, 'gemini.generateJobQuestions: fallback a mock');
      return this.fallback.generateJobQuestions(input);
    }
  }

  /** RF-03 — Extracción e inferencia de datos del CV (datos personales + ficha resumen). */
  async parseCv(input: ParseCvInput): Promise<ParseCvOutput> {
    try {
      const text = await this.callGemini({
        system: LEIA_PARSE_CV_SYSTEM_PROMPT,
        user: buildParseCvPrompt(input.cvText, input.fileName),
        maxTokens: 2000,
        temperature: 0.1,
        json: true,
      });
      return normalizeParsedCv(JSON.parse(extractJSON(text)), input.cvText);
    } catch (err) {
      logger.warn({ err }, 'gemini.parseCv: fallback a mock');
      return this.fallback.parseCv(input);
    }
  }

  async firstQuestion(input: FirstQuestionInput): Promise<string> {
    const sys = `Sos leIA — entrevistadora virtual con personalidad propia, español rioplatense, voseo.
Generás la apertura de una entrevista para "${input.job.title}" en "${input.job.company}".
Tono: ${input.job.preferences.toneOfVoice}. Stack: ${input.job.requirements.stack.join(', ')}.
Reglas para la apertura:
- Saludá por el nombre, presentate brevemente como leIA, mencioná la duración (${input.job.preferences.durationMinutes} min).
- Cerrá con UNA pregunta de arranque, abierta, conectada al puesto y al stack.
- Hablás como persona real, no como un guion corporativo. Variá las palabras, no uses "perfecto", "excelente", "espero que estés bien".
- Máximo 3-4 oraciones en total. Natural.${
      input.cvText
        ? '\n- El candidato subió su CV (viene en el mensaje). Tu apertura DEBE referenciar al menos un dato concreto del CV (empresa, tecnología o duración) — natural, sin recitarlo.'
        : ''
    }
Devolvé SOLO el texto a decir, sin comillas ni metadatos.`;
    const cvSection = input.cvText ? `\nCV del candidato (texto extraído):\n${input.cvText.slice(0, 3000)}` : '';
    try {
      const text = await this.callGemini({
        system: sys,
        user: `Candidato: ${input.candidateName}${cvSection}`,
        maxTokens: 220,
        temperature: 0.7,
      });
      return text.trim().replace(/^["']|["']$/g, '');
    } catch (err) {
      logger.warn({ err }, 'gemini.firstQuestion: fallback a mock');
      return this.fallback.firstQuestion(input);
    }
  }

  async evaluate(input: EvaluateInput): Promise<EvaluateOutput> {
    try {
      const text = await this.callGemini({
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
        maxTokens: 700,
        temperature: 0.6,
        json: true,
      });
      const parsed = parseEvaluate(text);

      // Piso: no permitir cerrar antes de cubrir las dimensiones objetivo con
      // varias preguntas. Evita entrevistas de 2-3 turnos.
      const minTurns = Math.max(6, input.job.preferences.dimensionsToCover.length);
      if (input.turnIndex < minTurns) {
        parsed.shouldFinish = false;
      }
      // Techo: por tiempo o por una cantidad alta de turnos.
      const targetSec = input.job.preferences.durationMinutes * 60;
      if (input.elapsedSec >= targetSec * 0.97 || input.history.length >= 16) {
        parsed.shouldFinish = true;
      }
      return parsed;
    } catch (err) {
      logger.warn({ err }, 'gemini.evaluate: fallback a mock');
      return this.fallback.evaluate(input);
    }
  }

  async buildReport1(input: Report1Input): Promise<Report1Payload> {
    try {
      const text = await this.callGemini({
        system: LEIA_REPORT1_SYSTEM_PROMPT,
        user: buildReport1Prompt({
          job: input.job,
          candidateName: input.candidateName,
          fullTranscript: input.fullTranscript.map((t) => ({ speaker: t.speaker, text: t.text })),
          durationSec: input.durationSec,
          behavior: input.behavior ?? null,
          cvText: input.cvText,
        }),
        maxTokens: 2400,
        temperature: 0.3,
        json: true,
      });
      const parsed = parseReport1(text);
      return {
        summary: parsed.summary,
        highlights: parsed.highlights,
        keyMoments: parsed.keyMoments,
        topicsCovered: parsed.topicsCovered,
        concerns: parsed.concerns,
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
      logger.warn({ err }, 'gemini.report1: fallback a mock');
      return this.fallback.buildReport1(input);
    }
  }

  async buildReport2(input: Report2Input): Promise<Report2Payload> {
    try {
      const text = await this.callGemini({
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
        maxTokens: 2400,
        temperature: 0.3,
        json: true,
      });
      const r2 = parseReport2(text, input.job.requirements.stack);
      r2.behavior = input.behavior ?? null;
      return r2;
    } catch (err) {
      logger.warn({ err }, 'gemini.report2: fallback a mock');
      return this.fallback.buildReport2(input);
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

Devolvé JSON ESTRICTO con esta forma:
{"score":<0.0-10.0>,"recommendation":"contratar|entrevistar|descartar","summary":"<2-3 oraciones>","strengths":["..."],"weaknesses":["..."]}

Criterios de recomendación:
- "contratar": score ≥ 7.5 — candidato con fuerte match en stack, seniority y experiencia
- "entrevistar": score 5.0–7.4 — candidato interesante con algunos gaps
- "descartar": score < 5.0 — candidato con gaps importantes o sin match con el puesto

"strengths": 2-4 fortalezas concretas (tecnologías, experiencia, logros del CV).
"weaknesses": 2-4 gaps concretos frente al puesto. Si no hay gaps relevantes, devolvé array vacío.
No agregues texto fuera del JSON.`;
    try {
      const cvPreview = input.cvText.slice(0, 4000);
      const text = await this.callGemini({
        system: sys,
        user: `CV (archivo: ${input.fileName}):\n${cvPreview}`,
        maxTokens: 600,
        temperature: 0.3,
        json: true,
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
      logger.warn({ err }, 'gemini.screenCv: fallback a mock');
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

  private async callGemini(opts: {
    system: string;
    user: string;
    maxTokens: number;
    temperature: number;
    json?: boolean;
  }): Promise<string> {
    const model = config.GEMINI_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
      config.GEMINI_API_KEY
    )}`;
    const body: any = {
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: [{ role: 'user', parts: [{ text: opts.user }] }],
      generationConfig: {
        temperature: opts.temperature,
        maxOutputTokens: opts.maxTokens,
        thinkingConfig: { thinkingBudget: 0 },
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      ],
    };
    if (opts.json) {
      body.generationConfig.responseMimeType = 'application/json';
    }

    // En 429 con retryDelay corto (<5s) hacemos UN retry; si es largo o el segundo
    // retry también falla, lanzamos para que el caller caiga al mock. Mejor UX
    // que esperar 50s para una respuesta de modelo.
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const text = (data.candidates?.[0]?.content?.parts ?? [])
          .map((p) => p.text ?? '')
          .join('');
        if (!text) throw new Error('Respuesta vacía de Gemini');
        return text;
      }
      const txt = await res.text();
      if (res.status === 429 && attempt === 0) {
        const delayMs = parseRetryDelayMs(txt) ?? 0;
        if (delayMs > 0 && delayMs <= 5_000) {
          logger.warn({ delayMs }, 'gemini 429: esperando retry corto');
          await sleep(delayMs);
          continue;
        }
        logger.warn({ delayMs }, 'gemini 429 con delay largo, fallback inmediato al mock');
        throw new Error(`Gemini 429 (delay ${delayMs}ms)`);
      }
      throw new Error(`Gemini ${res.status}: ${txt.slice(0, 400)}`);
    }
    throw new Error('Gemini: retry exhausted');
  }
}

/**
 * Timeout duro para cada request a Gemini. Sin esto, una conexión que se cuelga
 * (sin respuesta, sin cerrar) deja el fetch pendiente PARA SIEMPRE: como los
 * catch de buildReport/evaluate sólo atrapan errores lanzados —no un fetch
 * colgado—, el caller nunca cae al mock. En generateReports() eso se ve como
 * "Generando informe…" infinito; durante la entrevista, como leIA que no
 * responde. Con el timeout, un cuelgue se convierte en error → fallback al mock.
 */
const GEMINI_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = GEMINI_TIMEOUT_MS
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error(`Gemini timeout (${timeoutMs}ms)`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function parseRetryDelayMs(errBody: string): number | undefined {
  // Google manda { retryDelay: "30s" } dentro de details.
  const m = errBody.match(/"retryDelay"\s*:\s*"(\d+)s"/);
  if (m) return Math.min(parseInt(m[1], 10) + 1, 60) * 1000;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// -------------------- Parsers (idénticos a claude.ts) --------------------
function extractJSON(text: string): string {
  let trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    const m = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (m) trimmed = m[1].trim();
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) trimmed = trimmed.slice(start, end + 1);
  return trimmed.replace(/,\s*([\]}])/g, '$1');
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
): {
  summary: string;
  highlights: string[];
  keyMoments: string[];
  topicsCovered: string[];
  concerns: string[];
  behavioralObservations: string[];
} {
  const parsed = JSON.parse(extractJSON(text));
  const arr = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n).map(String) : []);
  return {
    summary: String(parsed.summary ?? ''),
    highlights: arr(parsed.highlights, 12),
    keyMoments: arr(parsed.keyMoments, 8),
    topicsCovered: arr(parsed.topicsCovered, 12),
    concerns: arr(parsed.concerns, 8),
    behavioralObservations: arr(parsed.behavioralObservations, 10),
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
    sentimentDistribution: normalizeSentiment(parsed.sentimentDistribution),
    // qualityDistribution y turnsAnalyzed los completa el engine (determinístico).
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

/** Normaliza un objeto de sentimiento a porcentajes enteros que suman 100. */
function normalizeSentiment(raw: any): { positive: number; neutral: number; negative: number; notApplicable: number } {
  const p = Math.max(0, Number(raw?.positive) || 0);
  const n = Math.max(0, Number(raw?.neutral) || 0);
  const g = Math.max(0, Number(raw?.negative) || 0);
  const na = Math.max(0, Number(raw?.notApplicable) || 0);
  const total = p + n + g + na;
  if (total <= 0) return { positive: 0, neutral: 0, negative: 0, notApplicable: 0 };
  const round = (x: number) => Math.round((x / total) * 100);
  const out = { positive: round(p), neutral: round(n), negative: round(g), notApplicable: round(na) };
  // Ajuste de redondeo para que sumen exactamente 100.
  const diff = 100 - (out.positive + out.neutral + out.negative + out.notApplicable);
  if (diff !== 0) {
    const maxKey = (Object.keys(out) as Array<keyof typeof out>).reduce((a, b) => (out[a] >= out[b] ? a : b));
    out[maxKey] += diff;
  }
  return out;
}

function avg(d: DimensionScores): number {
  return (
    (d.comunicacion + d.tecnicos + d.experiencia + d.resolucion + d.actitud + d.trabajoEquipo) / 6
  );
}
