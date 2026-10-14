import type { EmbeddingProvider } from '../providers/types';
import { env } from '../config/env';
import { logger } from '../config/logger';

export interface EmbeddingServiceOptions {
  batchSize?: number;
  maxRetries?: number;
  initialDelayMs?: number;
}

export class EmbeddingService {
  private readonly provider: EmbeddingProvider;
  private readonly expectedDim: number;
  private readonly batchSize: number;
  private readonly maxRetries: number;
  private readonly initialDelayMs: number;

  constructor(
    provider: EmbeddingProvider,
    options?: EmbeddingServiceOptions,
    expectedDim: number = env.EMBEDDING_DIM
  ) {
    this.provider = provider;
    this.expectedDim = expectedDim;
    this.batchSize = options?.batchSize ?? 20;
    this.maxRetries = options?.maxRetries ?? 3;
    this.initialDelayMs = options?.initialDelayMs ?? 200;
  }

  public async embedQuery(text: string): Promise<number[]> {
    const vector = await this.executeWithRetry(() => this.provider.embedQuery(text));
    this.assertDimension(vector);
    return vector;
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const allVectors: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const slice = texts.slice(i, i + this.batchSize);
      const batchVectors = await this.executeWithRetry(() => this.provider.embedBatch(slice));

      for (const vec of batchVectors) {
        this.assertDimension(vec);
        allVectors.push(vec);
      }
    }

    return allVectors;
  }

  private assertDimension(vec: number[]): void {
    if (vec.length !== this.expectedDim) {
      throw new Error(
        `Embedding dimension mismatch: provider returned ${vec.length} dimensions, expected ${this.expectedDim}`
      );
    }
  }

  private async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    let delay = this.initialDelayMs;

    while (attempt < this.maxRetries) {
      attempt++;
      try {
        return await fn();
      } catch (err) {
        if (attempt >= this.maxRetries) {
          logger.error({ err, attempt, maxRetries: this.maxRetries }, 'Embedding operation failed after all retries');
          throw err;
        }
        logger.warn({ err, attempt, nextDelayMs: delay }, 'Embedding operation failed; retrying with backoff...');
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }

    throw new Error('Unreachable: executeWithRetry loop ended unexpectedly');
  }
}
