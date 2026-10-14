import { describe, it, expect } from 'vitest';
import { MockEmbeddingProvider } from '../src/providers/embedding/mock';
import { MockLLMProvider } from '../src/providers/llm/mock';
import { probeEmbeddingDimension } from '../src/config/probe';

describe('Mock Providers and Startup Probe', () => {
  describe('MockEmbeddingProvider', () => {
    it('should generate vectors of the exact configured dimension', async () => {
      const provider1536 = new MockEmbeddingProvider('test-model', 1536);
      const vector1536 = await provider1536.embedQuery('database connection timeout');
      expect(vector1536).toHaveLength(1536);

      const provider768 = new MockEmbeddingProvider('test-nomic', 768);
      const vector768 = await provider768.embedQuery('database connection timeout');
      expect(vector768).toHaveLength(768);
    });

    it('should produce deterministic vectors for identical inputs', async () => {
      const provider = new MockEmbeddingProvider('test-model', 1536);
      const input = 'Error: ECONNREFUSED 127.0.0.1:5432';

      const v1 = await provider.embedQuery(input);
      const v2 = await provider.embedQuery(input);

      expect(v1).toEqual(v2);
    });

    it('should produce unit-normalized vectors (norm ~= 1.0)', async () => {
      const provider = new MockEmbeddingProvider('test-model', 1536);
      const vector = await provider.embedQuery('sample log line');

      const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
      expect(norm).toBeCloseTo(1.0, 4);
    });

    it('should support batch embedding', async () => {
      const provider = new MockEmbeddingProvider('test-model', 512);
      const batch = await provider.embedBatch(['line 1', 'line 2', 'line 3']);

      expect(batch).toHaveLength(3);
      expect(batch[0]).toHaveLength(512);
      expect(batch[1]).toHaveLength(512);
      expect(batch[2]).toHaveLength(512);
    });
  });

  describe('Startup Embedding Probe', () => {
    it('should succeed when provider dimension matches expected dimension', async () => {
      const provider = new MockEmbeddingProvider('test-model', 1536);
      await expect(probeEmbeddingDimension(provider, 1536)).resolves.not.toThrow();
    });

    it('should throw fatal error on dimension mismatch', async () => {
      const provider = new MockEmbeddingProvider('test-model', 768);
      await expect(probeEmbeddingDimension(provider, 1536)).rejects.toThrow(
        /FATAL: Embedding dimension mismatch! Provider "mock" returned 768 dimensions, but EMBEDDING_DIM is configured to 1536/
      );
    });
  });

  describe('MockLLMProvider', () => {
    it('should return valid JSON with diagnostic structure', async () => {
      const provider = new MockLLMProvider('test-llm');
      const response = await provider.generate('Diagnose this log');

      const parsed = JSON.parse(response);
      expect(parsed).toHaveProperty('severity');
      expect(parsed).toHaveProperty('summary');
      expect(parsed).toHaveProperty('probableRootCause');
      expect(parsed).toHaveProperty('immediateMitigation');
      expect(parsed).toHaveProperty('longTermFixes');
      expect(parsed).toHaveProperty('usedRefs');
      expect(Array.isArray(parsed.immediateMitigation)).toBe(true);
    });
  });
});
