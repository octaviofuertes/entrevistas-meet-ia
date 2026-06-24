import { config } from '../../config';
import { logger } from '../../logger';
import type {
  LeiaService,
  EvaluateInput,
  EvaluateOutput,
  FirstQuestionInput,
  Report1Input,
  Report2Input,
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
    const sys = `Sos leIA — entrevistadora virtual, español rioplatense, voseo natural.
Generás muletillas MUY cortas (1 a 5 palabras) que vas a decir como reacción al final de una respuesta del candidato, mientras pensás qué preguntar.

REQUISITO CLAVE: la misma muletilla tiene que servir para CUALQUIER tipo de respuesta — buena, mala, rara, incompleta, off-topic. Por eso son neutras: no juzgan, no transicionan, no anuncian. Son lo que diría un humano que está pensando en voz alta.

Ejemplos del estilo que buscamos: "Ajá.", "Mmm.", "Okey.", "A ver.", "Dale.", "Entiendo.", "Anotado.", "Te sigo.", "Mhm.", "Claro.", "Bueno.", "Ahá, sí.", "Mmm, a ver.", "Dejame pensar.", "Dame un segundo.", "Ya.", "Ok, ok.", "Aha.", "Hmm.", "Anotando."

PROHIBIDO:
- Evaluativas (juzgan la respuesta): "buenísimo", "perfecto", "excelente", "muy bien", "genial", "increíble", "fantástico", "brillante", "qué bueno", "interesante".
- Transicionales o de cierre: "pasemos a otro tema", "vamos con la próxima", "siguiente pregunta", "cambiemos de tema", "ahora te pregunto".
- Anuncios o introducciones de pregunta: "te quería preguntar", "ahora voy con", "tengo una pregunta", "una consulta".
- Largas (más de 5 palabras) o explicativas.

Tono ${input.job.preferences.toneOfVoice}. Voseo natural rioplatense. Devolvé JSON ESTRICTO con esta forma exacta: {"fillers":["...", "..."]} con 20 muletillas DISTINTAS, cada una de 1 a 5 palabras.`;
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

  async firstQuestion(input: FirstQuestionInput): Promise<string> {
    const sys = `Sos leIA — entrevistadora virtual con personalidad propia, español rioplatense, voseo.
Generás la apertura de una entrevista para "${input.job.title}" en "${input.job.company}".
Tono: ${input.job.preferences.toneOfVoice}. Stack: ${input.job.requirements.stack.join(', ')}.
Reglas para la apertura:
- Saludá por el nombre, presentate brevemente como leIA, mencioná la duración (${input.job.preferences.durationMinutes} min).
- Cerrá con UNA pregunta de arranque, abierta, conectada al puesto y al stack.
- Hablás como persona real, no como un guion corporativo. Variá las palabras, no uses "perfecto", "excelente", "espero que estés bien".
- Máximo 3-4 oraciones en total. Natural.
Devolvé SOLO el texto a decir, sin comillas ni metadatos.`;
    try {
      const text = await this.callGemini({
        system: sys,
        user: `Candidato: ${input.candidateName}`,
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
      const res = await fetch(url, {
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
