import 'dotenv/config';
import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  JWT_SECRET: z.string().min(16).default('cambia-este-secret-en-produccion-min32'),
  JWT_EXPIRES_IN: z.string().default('24h'),
  ADMIN_TOKEN: z.string().default('admin-demo-token-cambiar'),

  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  DATABASE_DRIVER: z.enum(['memory', 'postgres']).default('memory'),
  DATABASE_URL: z.string().default('postgresql://entrevistas:entrevistas@localhost:5432/entrevistas'),

  // leIA - IA propia del sistema. Drivers:
  //   mock   = heurística determinista (default, sin costo)
  //   claude = Anthropic Claude
  //   gemini = Google Generative Language (uso temporal mientras leIA tiene IA propia)
  LEIA_DRIVER: z.enum(['mock', 'claude', 'gemini']).default('mock'),
  LEIA_MODEL: z.string().default('claude-opus-4-7'),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash-lite'),

  // Recall.ai - bot que entra al Meet y entrega captions nativos.
  RECALL_DRIVER: z.enum(['mock', 'recall']).default('mock'),
  RECALL_API_KEY: z.string().optional().default(''),
  RECALL_REGION: z.string().default('us-east-1'),
  RECALL_BOT_NAME: z.string().default('leIA · Entrevistadora'),

  // ElevenLabs - TTS.
  TTS_DRIVER: z.enum(['mock', 'elevenlabs', 'gemini', 'edge']).default('mock'),
  ELEVENLABS_API_KEY: z.string().optional().default(''),
  ELEVENLABS_VOICE_ID: z.string().default('21m00Tcm4TlvDq8ikWAM'),
  ELEVENLABS_MODEL: z.string().default('eleven_multilingual_v2'),
  // Gemini TTS reusa GEMINI_API_KEY. Modelo y voz se pueden override por env.
  GEMINI_TTS_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_TTS_VOICE: z.string().default('Puck'),

  // Idioma por defecto de la entrevista (afecta voces y prompts).
  INTERVIEW_LANGUAGE: z.string().default('es'),

  // Job-from-link: dominios soportados (separados por coma) y timeout fetch.
  JOB_LINK_TIMEOUT_MS: z.coerce.number().default(15_000),
});

const parsed = ConfigSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Configuración inválida:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type AppConfig = typeof config;

export function summarizeDrivers() {
  return {
    database: config.DATABASE_DRIVER,
    leia: config.LEIA_DRIVER,
    recall: config.RECALL_DRIVER,
    tts: config.TTS_DRIVER,
  };
}

export function isDemoMode() {
  return (
    config.LEIA_DRIVER === 'mock' &&
    config.RECALL_DRIVER === 'mock' &&
    config.TTS_DRIVER === 'mock' &&
    config.DATABASE_DRIVER === 'memory'
  );
}
