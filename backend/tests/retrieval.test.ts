import { describe, it, expect, vi } from 'vitest';
import {
  computeCosineSimilarity,
  computeRRFScore
} from '../src/services/retrieval.service';
import { computeConfidence } from '../src/services/confidence';
import { EmbeddingService } from '../src/services/embedding.service';
import type { EmbeddingProvider } from '../src/providers/types';

describe('Retrieval & Confidence Math Services', () => {
  describe('Cosine Similarity (computeCosineSimilarity)', () => {
    it('returns 1.0 for identical normalized vectors', () => {
      const v = [0.6, 0.8];
      expect(computeCosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
    });

    it('returns 0.0 for orthogonal vectors', () => {
      const v1 = [1, 0, 0];
      const v2 = [0, 1, 0];
      expect(computeCosineSimilarity(v1, v2)).toBeCloseTo(0.0, 5);
    });

    it('returns -1.0 for opposite vectors', () => {
      const v1 = [0, 1];
      const v2 = [0, -1];
      expect(computeCosineSimilarity(v1, v2)).toBeCloseTo(-1.0, 5);
    });

    it('handles zero or mismatched vectors safely', () => {
      expect(computeCosineSimilarity([], [])).toBe(0);
      expect(computeCosineSimilarity([1, 2], [1])).toBe(0);
      expect(computeCosineSimilarity([0, 0], [0, 0])).toBe(0);
    });
  });

  describe('Reciprocal Rank Fusion (computeRRFScore)', () => {
    it('computes RRF score correctly for single and dual ranks', () => {
      // k = 60
      // rank 1 -> 1 / (60 + 1) = 1 / 61
      const scoreRank1 = computeRRFScore(1, undefined, 60);
      expect(scoreRank1).toBeCloseTo(1 / 61, 6);

      // rank 1 in keyword, rank 2 in vector
      // 1/61 + 1/62
      const dualScore = computeRRFScore(1, 2, 60);
      expect(dualScore).toBeCloseTo(1 / 61 + 1 / 62, 6);
    });

    it('prioritizes dual-branch hits over single-branch hits', () => {
      const dualRank3 = computeRRFScore(3, 3, 60); // 1/63 + 1/63 = 0.0317
      const singleRank1 = computeRRFScore(1, undefined, 60); // 1/61 = 0.0163

      expect(dualRank3).toBeGreaterThan(singleRank1);
    });
  });

  describe('Confidence Scoring (computeConfidence)', () => {
    it('returns 0 score when insufficientContext is true', () => {
      const result = computeConfidence({
        similarities: [0.95],
        validCitedRefs: 1,
        totalRefsReturnedByModel: 1,
        insufficientContext: true
      });

      expect(result.score).toBe(0);
      expect(result.top1).toBe(0);
    });

    it('returns 0 score when similarities array is empty', () => {
      const result = computeConfidence({
        similarities: [],
        validCitedRefs: 0,
        totalRefsReturnedByModel: 0
      });

      expect(result.score).toBe(0);
    });

    it('calculates confidence for a single cited chunk (margin = 0)', () => {
      const result = computeConfidence({
        similarities: [0.8],
        validCitedRefs: 1,
        totalRefsReturnedByModel: 1
      });

      // top1 = 0.8, margin = 0, coverage = 1.0
      // raw = 100 * (0.6 * 0.8 + 0.2 * 0 + 0.2 * 1.0) = 100 * (0.48 + 0.2) = 68
      expect(result.top1).toBe(0.8);
      expect(result.margin).toBe(0);
      expect(result.coverage).toBe(1.0);
      expect(result.score).toBe(68);
    });

    it('calculates confidence with margin when multiple chunks cited', () => {
      const result = computeConfidence({
        similarities: [0.90, 0.75],
        validCitedRefs: 2,
        totalRefsReturnedByModel: 2
      });

      // top1 = 0.90, top2 = 0.75 -> (0.90 - 0.75) / 0.15 = 1.0 (margin = 1.0)
      // coverage = 2/2 = 1.0
      // raw = 100 * (0.6 * 0.90 + 0.2 * 1.0 + 0.2 * 1.0) = 100 * (0.54 + 0.2 + 0.2) = 94
      expect(result.top1).toBe(0.9);
      expect(result.margin).toBe(1.0);
      expect(result.coverage).toBe(1.0);
      expect(result.score).toBe(94);
    });

    it('penalizes hallucinated refs in coverage factor', () => {
      const result = computeConfidence({
        similarities: [0.90],
        validCitedRefs: 1,
        totalRefsReturnedByModel: 3 // model claimed 3 refs, only 1 was valid
      });

      // coverage = 1 / 3 = 0.3333
      expect(result.coverage).toBeCloseTo(0.3333, 3);
      expect(result.score).toBeLessThan(70);
    });
  });

  describe('EmbeddingService Batching & Dimension Checks', () => {
    it('batches requests according to batchSize', async () => {
      const embedBatchMock = vi.fn().mockImplementation((texts: string[]) => {
        return Promise.resolve(texts.map(() => new Array(4).fill(0.5)));
      });

      const mockProvider: EmbeddingProvider = {
        name: 'test-batch',
        modelName: 'test',
        dimension: 4,
        embedQuery: vi.fn(),
        embedBatch: embedBatchMock
      };

      const service = new EmbeddingService(mockProvider, { batchSize: 2 }, 4);
      const results = await service.embedBatch(['text1', 'text2', 'text3', 'text4', 'text5']);

      expect(results).toHaveLength(5);
      // 5 items with batch size 2 -> 3 batch calls (2, 2, 1)
      expect(embedBatchMock).toHaveBeenCalledTimes(3);
    });

    it('throws error when provider returns mismatched dimension', async () => {
      const mockProvider: EmbeddingProvider = {
        name: 'test-mismatch',
        modelName: 'test',
        dimension: 10,
        embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]), // returns 3 instead of 10
        embedBatch: vi.fn()
      };

      const service = new EmbeddingService(mockProvider, {}, 10);
      await expect(service.embedQuery('test')).rejects.toThrow(
        /Embedding dimension mismatch: provider returned 3 dimensions, expected 10/
      );
    });
  });
});
