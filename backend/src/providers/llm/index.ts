import type { LLMProvider } from '../types';
import { MockLLMProvider } from './mock';
import { OpenAILLMProvider } from './openai';
import { AnthropicLLMProvider } from './anthropic';
import { OllamaLLMProvider } from './ollama';
import type { Env } from '../../config/env';

export function createLLMProvider(env: Env): LLMProvider {
  switch (env.LLM_PROVIDER) {
    case 'mock':
      return new MockLLMProvider(env.LLM_MODEL);
    case 'openai':
      return new OpenAILLMProvider(env.OPENAI_API_KEY || '', env.LLM_MODEL);
    case 'anthropic':
      return new AnthropicLLMProvider(env.ANTHROPIC_API_KEY || '', env.LLM_MODEL);
    case 'ollama':
      return new OllamaLLMProvider(env.OLLAMA_BASE_URL, env.LLM_MODEL);
    default:
      throw new Error(`Unsupported LLM provider: ${env.LLM_PROVIDER}`);
  }
}
