import crypto from 'node:crypto';
import type { EmbeddingProvider } from '../types';

export class MockEmbeddingProvider implements EmbeddingProvider {
  public readonly name = 'mock';
  public readonly modelName: string;
  public readonly dimension: number;

  constructor(modelName = 'mock-embedding', dimension = 1536) {
    this.modelName = modelName;
    this.dimension = dimension;
  }

  public async embedQuery(text: string): Promise<number[]> {
    return this.generateDeterministicVector(text, this.dimension);
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embedQuery(text)));
  }

  private generateDeterministicVector(text: string, dim: number): number[] {
    const hash = crypto.createHash('sha256').update(text).digest();
    const vector: number[] = new Array(dim);

    // Seeded linear congruential generator initialized from hash
    let seed = hash.readUInt32LE(0);
    for (let i = 0; i < dim; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      // Map to range [-1.0, 1.0]
      vector[i] = (seed / 4294967295) * 2 - 1;
    }

    // L2 Normalize
    let sumSq = 0;
    for (let i = 0; i < dim; i++) {
      sumSq += vector[i] * vector[i];
    }
    const norm = Math.sqrt(sumSq) || 1;
    for (let i = 0; i < dim; i++) {
      vector[i] = vector[i] / norm;
    }

    return vector;
  }
}
