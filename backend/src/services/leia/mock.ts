import type {
  LeiaService,
  EvaluateInput,
  EvaluateOutput,
  FirstQuestionInput,
  Report1Input,
  Report2Input,
} from './index';
import type { DimensionScores, Report1Payload, Report2Payload } from '../../types';

/**
 * Mock determinista de leIA. Usa heurísticas sobre el transcript:
 *  - presencia de keywords del stack
 *  - longitud y estructura de la respuesta
 *  - ejemplos concretos / números
 * Devuelve evaluaciones realistas para que el sistema funcione end-to-end sin Claude.
 */
export class MockLeia implements LeiaService {
  async generateFillers(_input: FirstQuestionInput): Promise<string[]> {
    // Mínimo de respaldo cuando no hay IA disponible.
    return [
      'Un segundo.',
      'Dejame pensar.',
      'Ajá, dame un momento.',
      'Mhm, anotando eso.',
    ];
  }

  async generateClosing(input: FirstQuestionInput): Promise<string> {
    return `Listo ${input.candidateName}, terminamos por hoy. Gracias por tu tiempo, vas a recibir el feedback en los próximos días.`;
  }

  async firstQuestion(input: FirstQuestionInput): Promise<string> {
    await sleep(150);
    const tone = input.job.preferences.toneOfVoice;
    const opener =
      tone === 'formal'
        ? 'Buenos días'
        : tone === 'tecnico'
          ? 'Bienvenido'
          : 'Hola';
    return `${opener} ${input.candidateName}, soy leIA, la entrevistadora virtual para el puesto de ${input.job.title} en ${input.job.company}. Vamos a tener una conversación de unos ${input.job.preferences.durationMinutes} minutos. Para empezar, contame brevemente sobre tu experiencia y qué te motivó a postularte a este puesto.`;
  }

  async evaluate(input: EvaluateInput): Promise<EvaluateOutput> {
    await sleep(300 + Math.random() * 400);

    const transcript = input.lastAnswer.trim();
    const wordCount = transcript.split(/\s+/).filter(Boolean).length;
    const isEmpty = wordCount < 3;
    const isShort = wordCount < 15;

    const stackLower = input.job.requirements.stack.map((s) => s.toLowerCase());
    const transcriptLower = transcript.toLowerCase();

    const stackMatches = stackLower.filter((s) => transcriptLower.includes(s)).length;
    const hasExample = /por ejemplo|recuerdo|cuando trabaj|en el proyecto|en mi experienc/i.test(transcript);
    const hasStructure = /primero|segundo|por un lado|por otro|finalmente|en conclusi/i.test(transcript);
    const hasNumbers = /\d+/.test(transcript);
    const showsLeadership = /lider|mentore|coordin|equipo|gestion/i.test(transcript);
    const showsCollab = /equipo|junto|compañer|pair|review|ayud/i.test(transcript);

    const base = isEmpty ? 1.5 : isShort ? 4.5 : Math.min(8.5, 5.5 + wordCount / 40);
    const v = () => (Math.random() - 0.5) * 0.6;
    const clamp = (n: number) => Math.max(0, Math.min(10, Math.round(n * 10) / 10));

    const dimensions: DimensionScores = {
      comunicacion: clamp(base + (hasStructure ? 1.2 : 0) + v()),
      tecnicos: clamp(base + stackMatches * 0.6 + (hasNumbers ? 0.5 : 0) + v()),
      experiencia: clamp(base + (hasExample ? 1.3 : -0.5) + v()),
      resolucion: clamp(base + (hasExample && hasNumbers ? 1.2 : 0) + v()),
      actitud: clamp(base + 0.6 + v()),
      trabajoEquipo: clamp(base + (showsCollab ? 1.2 : 0) + (showsLeadership ? 0.7 : 0) + v()),
    };

    const score = clamp(
      (dimensions.comunicacion +
        dimensions.tecnicos +
        dimensions.experiencia +
        dimensions.resolucion +
        dimensions.actitud +
        dimensions.trabajoEquipo) /
        6
    );

    const flags: string[] = [];
    if (isEmpty) flags.push('respuesta_vacia');
    if (isShort && !isEmpty) flags.push('respuesta_muy_breve');
    if (stackMatches === 0 && wordCount > 20 && input.turnIndex >= 1) {
      flags.push('no_menciona_stack_requerido');
    }

    const rationale = isEmpty
      ? 'El candidato no respondió o la respuesta es incomprensible.'
      : isShort
        ? 'Respuesta correcta pero breve. Falta desarrollo y ejemplos.'
        : score >= 7.5
          ? 'Respuesta sólida con buenos elementos técnicos y ejemplos concretos.'
          : score >= 5.5
            ? 'Respuesta aceptable; se puede profundizar en aspectos técnicos.'
            : 'Respuesta con bajo nivel de detalle y poca evidencia técnica.';

    // Piso de turnos: no cerrar antes de cubrir las dimensiones objetivo.
    const targetSec = input.job.preferences.durationMinutes * 60;
    const minTurns = Math.max(6, input.job.preferences.dimensionsToCover.length);
    const tooManyTurns = input.history.length >= 14;
    const timeUp = input.elapsedSec >= targetSec * 0.9;
    const shouldFinish = input.turnIndex >= minTurns && (tooManyTurns || timeUp);

    // Si la respuesta es vacía o muy corta, pedir aclaración antes de avanzar.
    let isClarification = false;
    let nextQuestion: string;
    if (!shouldFinish && (isEmpty || (isShort && input.turnIndex > 0))) {
      isClarification = true;
      nextQuestion = isEmpty
        ? 'No te llegué a escuchar bien. ¿Podrías repetirlo?'
        : '¿Podrías ampliarlo un poco? Me gustaría entender mejor a qué te referías.';
    } else if (shouldFinish) {
      nextQuestion =
        'Para cerrar, ¿hay algo más que quieras destacar de tu perfil o alguna pregunta que tengas sobre el puesto?';
    } else {
      nextQuestion = pickNextQuestion({
        job: input.job,
        turnIndex: input.turnIndex,
        dims: dimensions,
        hasExample,
        stackMatches,
        lastAnswer: input.lastAnswer,
        askedQuestions: input.history.map((h) => h.question),
      });
    }

    return {
      evaluation: { score, dimensions, flags, rationale },
      nextQuestion,
      isClarification,
      shouldFinish,
    };
  }

  async buildReport1(input: Report1Input): Promise<Report1Payload> {
    await sleep(150);
    const candidateLines = input.fullTranscript.filter((t) => t.speaker === 'candidate');
    const wordCount = candidateLines.reduce(
      (acc, l) => acc + l.text.split(/\s+/).filter(Boolean).length,
      0
    );

    const highlights: string[] = [];
    if (candidateLines.length > 0) {
      highlights.push(`El candidato respondió ${candidateLines.length} preguntas`);
    }
    if (wordCount > 0) {
      highlights.push(`Volumen de respuesta: ${wordCount} palabras`);
    }
    const interesting = candidateLines
      .filter((l) => l.text.length > 60)
      .slice(0, 3)
      .map((l) => `"${l.text.slice(0, 140)}${l.text.length > 140 ? '…' : ''}"`);
    highlights.push(...interesting);

    const summary = `Entrevista para ${input.job.title} con ${input.candidateName}. ` +
      `Duración aproximada: ${Math.round(input.durationSec / 60)} minutos. ` +
      `Se cubrieron ${candidateLines.length} preguntas. ` +
      (wordCount > 200
        ? 'El candidato se explayó con buen nivel de detalle.'
        : 'El candidato dio respuestas breves; podría requerir una segunda instancia con más profundidad.');

    const behavioralObservations: string[] = [];
    const b = input.behavior;
    if (b) {
      const total = b.durationSec || input.durationSec || 1;
      const readingPct = Math.round((b.attentionSec.reading / total) * 100);
      const presencePct = Math.round((b.faceVisibleSec / total) * 100);
      behavioralObservations.push(`Presencia en cámara: ${presencePct}% del tiempo.`);
      if (readingPct >= 10) {
        behavioralObservations.push(
          `Se observó mirada baja prolongada en aproximadamente ${readingPct}% del tiempo (${b.readingEvents} episodios). Podría indicar consulta de notas.`
        );
      }
      if (b.dominantExpression && b.dominantExpression !== 'neutral') {
        behavioralObservations.push(`Expresión predominante: ${b.dominantExpression}.`);
      }
    }

    return {
      summary,
      highlights,
      behavioralObservations,
      behavior: input.behavior ?? null,
      fullTranscript: input.fullTranscript.map((t) => ({
        speaker: t.speaker,
        text: t.text,
        atMs: t.atMs,
      })),
      durationSec: input.durationSec,
      language: input.language,
    };
  }

  async buildReport2(input: Report2Input): Promise<Report2Payload> {
    await sleep(200);

    if (input.evaluations.length === 0) {
      return {
        scoreTotal: 0,
        dimensions: emptyDims(),
        stackScores: Object.fromEntries(input.job.requirements.stack.map((s) => [s, 0])),
        softskills: 0,
        strengths: [],
        weaknesses: ['No hay evaluaciones registradas'],
        flags: ['sin_datos'],
        recomendacion: 'descartar',
        recomendacionReason: 'No se obtuvo respuesta evaluable del candidato.',
      };
    }

    const avg = (key: keyof DimensionScores) =>
      round1(
        input.evaluations.reduce((a, e) => a + e.dims[key], 0) / input.evaluations.length
      );

    const dimensions: DimensionScores = {
      comunicacion: avg('comunicacion'),
      tecnicos: avg('tecnicos'),
      experiencia: avg('experiencia'),
      resolucion: avg('resolucion'),
      actitud: avg('actitud'),
      trabajoEquipo: avg('trabajoEquipo'),
    };
    const scoreTotal = round1(
      (dimensions.comunicacion +
        dimensions.tecnicos +
        dimensions.experiencia +
        dimensions.resolucion +
        dimensions.actitud +
        dimensions.trabajoEquipo) /
        6
    );

    // Score por tecnología: heurística simple basada en menciones en el transcript
    const stackScores: Record<string, number> = {};
    for (const tech of input.job.requirements.stack) {
      const mentions = input.evaluations.filter((e) =>
        e.transcript.toLowerCase().includes(tech.toLowerCase())
      ).length;
      const fromTech = Math.min(10, mentions * 2 + dimensions.tecnicos * 0.6);
      stackScores[tech] = round1(fromTech);
    }

    const softskills = round1((dimensions.comunicacion + dimensions.actitud + dimensions.trabajoEquipo) / 3);

    const strengths: string[] = [];
    if (dimensions.tecnicos >= 7.5) strengths.push('Sólido dominio técnico del stack requerido');
    if (dimensions.comunicacion >= 7.5) strengths.push('Excelente capacidad de comunicación estructurada');
    if (dimensions.experiencia >= 7.5) strengths.push('Experiencia relevante con ejemplos concretos');
    if (dimensions.trabajoEquipo >= 7.5) strengths.push('Demuestra mentalidad colaborativa');
    if (strengths.length === 0) strengths.push('Mantuvo un tono profesional durante toda la entrevista');

    const weaknesses: string[] = [];
    if (dimensions.tecnicos < 6) weaknesses.push('Falta profundidad técnica en el stack del puesto');
    if (dimensions.resolucion < 6) weaknesses.push('Razonamiento ante escenarios poco desarrollado');
    if (dimensions.experiencia < 6) weaknesses.push('Pocos ejemplos concretos de experiencia previa');
    if (dimensions.comunicacion < 6) weaknesses.push('Estructura de las respuestas mejorable');
    if (weaknesses.length === 0) weaknesses.push('Algunos puntos podrían explicarse con más detalle');

    const recomendacion: 'avanzar' | 'segunda_instancia' | 'descartar' =
      scoreTotal >= 7.5 ? 'avanzar' : scoreTotal >= 5.5 ? 'segunda_instancia' : 'descartar';

    const recomendacionReason =
      recomendacion === 'avanzar'
        ? `Promedio ${scoreTotal}/10 con desempeño parejo. Avanzar a entrevista técnica/final.`
        : recomendacion === 'segunda_instancia'
          ? `Promedio ${scoreTotal}/10 con fortalezas claras pero zonas grises. Recomendamos una segunda entrevista enfocada.`
          : `Promedio ${scoreTotal}/10 con brechas significativas. No avanzar en este proceso.`;

    const allFlags = Array.from(new Set(input.evaluations.flatMap((e) => e.flags)));

    const behavioralObservations: string[] = [];
    let suspectedReading = false;
    const b = input.behavior;
    if (b) {
      const total = b.durationSec || 1;
      const readingPct = Math.round((b.attentionSec.reading / total) * 100);
      const presencePct = Math.round((b.faceVisibleSec / total) * 100);
      if (readingPct >= 25) {
        suspectedReading = true;
        behavioralObservations.push(
          `Mirada baja prolongada en ${readingPct}% del tiempo — fuerte indicio de lectura asistida.`
        );
      } else if (readingPct >= 10) {
        behavioralObservations.push(
          `Mirada baja en ${readingPct}% del tiempo, dentro de un rango aceptable.`
        );
      }
      if (presencePct < 70) {
        behavioralObservations.push(`Baja presencia frente a la cámara: ${presencePct}%.`);
      }
    }

    return {
      scoreTotal,
      dimensions,
      stackScores,
      softskills,
      strengths,
      weaknesses,
      flags: allFlags,
      behavioralObservations,
      suspectedReading,
      behavior: input.behavior ?? null,
      recomendacion,
      recomendacionReason,
    };
  }
}

/**
 * Fallback heurístico (solo se usa cuando la IA no está disponible).
 * Alterna preguntas personales y técnicas, intenta engancharse con una palabra
 * de la última respuesta, y rota por un banco amplio para no repetir.
 */
function pickNextQuestion(input: {
  job: any;
  turnIndex: number;
  dims: DimensionScores;
  hasExample: boolean;
  stackMatches: number;
  lastAnswer: string;
  askedQuestions: string[];
}): string {
  const stack = input.job.requirements.stack as string[];
  const tech: string = stack[input.turnIndex % stack.length] ?? 'tu stack principal';
  const tech2: string = stack[(input.turnIndex + 1) % stack.length] ?? tech;
  const keyword = extractKeyword(input.lastAnswer);
  const ref = keyword ? `Recién mencionaste "${keyword}". ` : '';

  // Banco amplio, organizado por fase. Mezclamos personal y técnica alternando por turno.
  const personales = [
    '¿Qué fue lo que más te enganchó de esta búsqueda en particular?',
    '¿Qué tipo de problemas son los que más disfrutás resolver?',
    'Contame un momento en el que la pasaste mal en un proyecto y qué aprendiste.',
    '¿Cómo es tu forma ideal de trabajar en equipo?',
    '¿Qué estás buscando en tu próximo lugar de trabajo?',
    '¿Cómo te mantenés actualizado con la tecnología?',
    'Contame de una vez que te equivocaste feo y cómo lo manejaste.',
  ];
  const tecnicas = [
    `${ref}¿Cómo encarás un problema de performance en ${tech}?`,
    `${ref}Contame una decisión técnica con ${tech} que hoy harías distinto.`,
    `¿Qué trade-offs ves entre ${tech} y ${tech2}?`,
    `${ref}¿Cómo testeás lo que hacés con ${tech}?`,
    `Te llega un bug en producción con ${tech} que no reproducís local. ¿Cómo lo encarás?`,
    `Si arrancaras un proyecto nuevo con ${stack.slice(0, 2).join(' y ')}, ¿cuáles serían tus primeras decisiones?`,
    `${ref}¿Cómo le explicarías ${tech} a alguien que recién arranca?`,
  ];
  const experiencia = [
    input.hasExample
      ? `${ref}¿Podrías profundizar en los desafíos técnicos de ese proyecto?`
      : '¿Podrías darme un ejemplo concreto de un proyecto donde aplicaste todo esto?',
    'Contame el proyecto del que más orgulloso/a estás y por qué.',
    '¿Cuál fue tu rol exacto en ese proyecto y qué decisiones tomaste vos?',
  ];

  // Alternancia: pares = personal/experiencia, impares = técnica.
  const pool =
    input.turnIndex % 2 === 1
      ? tecnicas
      : input.turnIndex % 4 === 0
        ? personales
        : experiencia;

  // Elegir una que NO se haya hecho aún (comparación laxa por inclusión).
  const asked = input.askedQuestions.map((q) => q.toLowerCase());
  const fresh = pool.filter(
    (q) => !asked.some((a) => a.includes(q.toLowerCase().slice(0, 25)))
  );
  const candidates = fresh.length ? fresh : pool;
  return candidates[input.turnIndex % candidates.length];
}

function extractKeyword(answer: string): string | null {
  const stop = new Set([
    'para','porque','cuando','tambien','entonces','despues','aunque','mientras','siempre',
    'nuestro','nuestra','proyecto','equipo','trabajo','persona','mucho','mucha','bastante',
    'siendo','estaba','estuve','tenia','hacer','hacia','poder','sobre','desde','hasta',
  ]);
  const words = (answer || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9áéíóúñ\s]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !stop.has(w));
  if (words.length === 0) return null;
  // La palabra más larga suele ser la más informativa (nombre de tech, concepto).
  return words.sort((a, b) => b.length - a.length)[0];
}

function emptyDims(): DimensionScores {
  return {
    comunicacion: 0,
    tecnicos: 0,
    experiencia: 0,
    resolucion: 0,
    actitud: 0,
    trabajoEquipo: 0,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
