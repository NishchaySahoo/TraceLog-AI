import { describe, it, expect } from 'vitest';
import { validateEnv, envSchema } from '../src/config/env';

describe('Environment Configuration (env.ts)', () => {
  it('should parse valid default environment variables', () => {
    const parsed = validateEnv({
      PORT: '5000',
      MONGO_URI: 'mongodb://127.0.0.1:27017/tracelog_test',
      CORS_ORIGINS: 'http://localhost:3000,http://localhost:5173',
      RETRIEVAL_MODE: 'memory',
      EMBEDDING_PROVIDER: 'mock',
      LLM_PROVIDER: 'mock',
      EMBEDDING_MODEL: 'text-embedding-3-small',
      EMBEDDING_DIM: '1536',
      LLM_MODEL: 'gpt-4o-mini'
    });

    expect(parsed.PORT).toBe(5000);
    expect(parsed.CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://localhost:5173']);
    expect(parsed.RETRIEVAL_MODE).toBe('memory');
    expect(parsed.EMBEDDING_PROVIDER).toBe('mock');
    expect(parsed.EMBEDDING_DIM).toBe(1536);
  });

  it('should throw error when OPENAI_API_KEY is missing for openai embedding provider', () => {
    expect(() =>
      validateEnv({
        EMBEDDING_PROVIDER: 'openai',
        OPENAI_API_KEY: ''
      })
    ).toThrow('OPENAI_API_KEY is required when EMBEDDING_PROVIDER is "openai"');
  });

  it('should throw error when ANTHROPIC_API_KEY is missing for anthropic llm provider', () => {
    expect(() =>
      validateEnv({
        LLM_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: ''
      })
    ).toThrow('ANTHROPIC_API_KEY is required when LLM_PROVIDER is "anthropic"');
  });

  it('should throw error for invalid retrieval mode', () => {
    expect(() =>
      validateEnv({
        RETRIEVAL_MODE: 'invalid_mode'
      })
    ).toThrow('Environment validation failed');
  });

  it('should parse boolean or string for STORE_RAW_LOGS correctly', () => {
    const parsedFalse = envSchema.parse({ STORE_RAW_LOGS: 'false' });
    expect(parsedFalse.STORE_RAW_LOGS).toBe(false);

    const parsedTrue = envSchema.parse({ STORE_RAW_LOGS: 'true' });
    expect(parsedTrue.STORE_RAW_LOGS).toBe(true);
  });
});
