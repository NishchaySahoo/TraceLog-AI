import type { EmbeddingProvider } from '../types';
import { MockEmbeddingProvider } from './mock';
import { OpenAIEmbeddingProvider } from './openai';
import { OllamaEmbeddingProvider } from './ollama';
import type { Env } from '../../config/env';

export function createEmbeddingProvider(env: Env): EmbeddingProvider {
  switch (env.EMBEDDING_PROVIDER) {
    case 'mock':
      return new MockEmbeddingProvider(env.EMBEDDING_MODEL, env.EMBEDDING_DIM);
    case 'openai':
      return new OpenAIEmbeddingProvider(
        env.OPENAI_API_KEY || '',
        env.EMBEDDING_MODEL,
        env.EMBEDDING_DIM
      );
    case 'ollama':
      return new OllamaEmbeddingProvider(
        env.OLLAMA_BASE_URL,
        env.EMBEDDING_MODEL,
        env.EMBEDDING_DIM
      );
    default:
      throw new Error(`Unsupported embedding provider: ${env.EMBEDDING_PROVIDER}`);
  }
}
