import type { LLMProvider } from '../types';

export class MockLLMProvider implements LLMProvider {
  public readonly name = 'mock';
  public readonly modelName: string;
  private responseGenerator?: (prompt: string, systemPrompt?: string) => Promise<string> | string;

  constructor(
    modelName = 'mock-llm',
    responseGenerator?: (prompt: string, systemPrompt?: string) => Promise<string> | string
  ) {
    this.modelName = modelName;
    this.responseGenerator = responseGenerator;
  }

  public setResponseGenerator(
    generator: (prompt: string, systemPrompt?: string) => Promise<string> | string
  ): void {
    this.responseGenerator = generator;
  }

  public async generate(prompt: string, systemPrompt?: string): Promise<string> {
    if (this.responseGenerator) {
      return this.responseGenerator(prompt, systemPrompt);
    }

    // Default realistic diagnostic JSON response
    return JSON.stringify({
      severity: 'HIGH',
      summary: 'Connection pool timeout caused service request drop spike.',
      probableRootCause: 'Active connections exceeded max_connections limit during traffic spike.',
      immediateMitigation: [
        {
          step: 'Terminate idle-in-transaction connections older than 5 minutes.',
          refs: [1]
        }
      ],
      longTermFixes: [
        {
          step: 'Configure PgBouncer default_pool_size or scale connection limit.',
          refs: [1]
        }
      ],
      hypotheses: [
        'Unclosed database transactions causing connection leaks.'
      ],
      usedRefs: [1]
    });
  }
}
