import { z } from 'zod';
import dotenv from 'dotenv';

// Load .env file
dotenv.config();

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(5000),
    MONGO_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/tracelog'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((val) => val.split(',').map((s) => s.trim()).filter(Boolean)),
    RETRIEVAL_MODE: z.enum(['memory', 'atlas']).default('memory'),
    EMBEDDING_PROVIDER: z.enum(['openai', 'ollama', 'mock']).default('mock'),
    LLM_PROVIDER: z.enum(['openai', 'anthropic', 'ollama', 'mock']).default('mock'),
    EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
    EMBEDDING_DIM: z.coerce.number().int().positive().default(1536),
    LLM_MODEL: z.string().min(1).default('gpt-4o-mini'),
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    OLLAMA_BASE_URL: z.string().url().default('http://host.docker.internal:11434'),
    MAX_LOG_BYTES: z.coerce.number().int().positive().default(200000),
    MAX_RUNBOOK_BYTES: z.coerce.number().int().positive().default(500000),
    RETRIEVAL_TOP_K: z.coerce.number().int().positive().default(5),
    MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.3),
    STORE_RAW_LOGS: z
      .union([z.boolean(), z.string()])
      .default(false)
      .transform((val) => (typeof val === 'boolean' ? val : val === 'true'))
  })
  .superRefine((data, ctx) => {
    if (data.EMBEDDING_PROVIDER === 'openai' && (!data.OPENAI_API_KEY || data.OPENAI_API_KEY.trim() === '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'OPENAI_API_KEY is required when EMBEDDING_PROVIDER is "openai"',
        path: ['OPENAI_API_KEY']
      });
    }

    if (data.LLM_PROVIDER === 'openai' && (!data.OPENAI_API_KEY || data.OPENAI_API_KEY.trim() === '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'OPENAI_API_KEY is required when LLM_PROVIDER is "openai"',
        path: ['OPENAI_API_KEY']
      });
    }

    if (data.LLM_PROVIDER === 'anthropic' && (!data.ANTHROPIC_API_KEY || data.ANTHROPIC_API_KEY.trim() === '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ANTHROPIC_API_KEY is required when LLM_PROVIDER is "anthropic"',
        path: ['ANTHROPIC_API_KEY']
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(customEnv?: Record<string, unknown>): Env {
  const result = envSchema.safeParse(customEnv ?? process.env);
  if (!result.success) {
    const formattedErrors = result.error.errors
      .map((err) => `  - ${err.path.join('.')}: ${err.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${formattedErrors}`);
  }
  return result.data;
}

export const env: Env = validateEnv();
