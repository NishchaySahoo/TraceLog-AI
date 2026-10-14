import mongoose from 'mongoose';
import { RunbookChunk, type IRunbookChunk } from '../models/RunbookChunk';
import { runbookMemoryCache, type CachedChunk } from './runbook.service';
import type { EmbeddingService } from './embedding.service';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { VECTOR_INDEX_NAME } from '../config/vectorIndex';

export interface RetrievalInput {
  sanitizedLog: string;
  signature: string;
  errorTokens: string[];
  techKeywords: string[];
  serviceName?: string;
}

export interface RetrievedChunk {
  chunkId: string;
  runbookId: string;
  serviceName: string;
  fileName: string;
  headerPath: string[];
  headerContext: string;
  anchor: string;
  chunkText: string;
  cosineSimilarity: number;
  keywordRank?: number;
  vectorRank?: number;
  fusedScore: number;
  retrievalSources: Array<'keyword' | 'vector'>;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  serviceFallbackTriggered: boolean;
  totalCandidatesEvaluated: number;
}

export function computeCosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

export function computeRRFScore(keywordRank?: number, vectorRank?: number, k = 60): number {
  let score = 0;
  if (keywordRank !== undefined && keywordRank > 0) {
    score += 1 / (k + keywordRank);
  }
  if (vectorRank !== undefined && vectorRank > 0) {
    score += 1 / (k + vectorRank);
  }
  return score;
}

export class RetrievalService {
  private readonly embeddingService: EmbeddingService;
  private readonly topK: number;
  private readonly minSimilarity: number;

  constructor(
    embeddingService: EmbeddingService,
    topK: number = env.RETRIEVAL_TOP_K,
    minSimilarity: number = env.MIN_SIMILARITY
  ) {
    this.embeddingService = embeddingService;
    this.topK = topK;
    this.minSimilarity = minSimilarity;
  }

  public async retrieve(input: RetrievalInput): Promise<RetrievalResult> {
    const targetService = input.serviceName?.trim() || undefined;

    // First attempt with service filter (if provided)
    const initialResult = await this.executeHybridSearch(input, targetService);

    // Fallback: If serviceName was provided but fewer than 2 results found, retry without service filter
    if (targetService && initialResult.chunks.length < 2) {
      logger.info({ serviceName: targetService, count: initialResult.chunks.length }, 'Fewer than 2 candidates found; falling back to global retrieval');
      const fallbackResult = await this.executeHybridSearch(input, undefined);
      return {
        ...fallbackResult,
        serviceFallbackTriggered: true
      };
    }

    return {
      ...initialResult,
      serviceFallbackTriggered: false
    };
  }

  public async executeHybridSearch(
    input: RetrievalInput,
    serviceFilter?: string
  ): Promise<{ chunks: RetrievedChunk[]; totalCandidatesEvaluated: number }> {
    // 1. Keyword search (top 20)
    const keywordHits = await this.searchKeywords(input, serviceFilter);

    // 2. Vector search (top 20)
    const vectorHits = await this.searchVector(input, serviceFilter);

    // 3. Fuse with Reciprocal Rank Fusion
    const mergedMap = new Map<
      string,
      {
        chunkData: {
          chunkId: string;
          runbookId: string;
          serviceName: string;
          fileName: string;
          headerPath: string[];
          headerContext: string;
          anchor: string;
          chunkText: string;
        };
        cosineSimilarity: number;
        keywordRank?: number;
        vectorRank?: number;
        sources: Set<'keyword' | 'vector'>;
      }
    >();

    // Index keyword ranks
    keywordHits.forEach((hit, idx) => {
      const rank = idx + 1;
      mergedMap.set(hit.chunkId, {
        chunkData: hit,
        cosineSimilarity: 0,
        keywordRank: rank,
        sources: new Set(['keyword'])
      });
    });

    // Index vector ranks & similarities
    vectorHits.forEach((hit, idx) => {
      const rank = idx + 1;
      const existing = mergedMap.get(hit.chunkId);
      if (existing) {
        existing.vectorRank = rank;
        existing.cosineSimilarity = hit.cosineSimilarity;
        existing.sources.add('vector');
      } else {
        mergedMap.set(hit.chunkId, {
          chunkData: hit,
          cosineSimilarity: hit.cosineSimilarity,
          vectorRank: rank,
          sources: new Set(['vector'])
        });
      }
    });

    // Compute fused scores and filter
    const fusedList: RetrievedChunk[] = [];
    for (const [chunkId, item] of mergedMap.entries()) {
      const fusedScore = computeRRFScore(item.keywordRank, item.vectorRank);

      // Rule: Drop chunks where cosineSimilarity < MIN_SIMILARITY unless they have a keyword hit
      const hasKeywordHit = item.sources.has('keyword');
      if (!hasKeywordHit && item.cosineSimilarity < this.minSimilarity) {
        continue;
      }

      fusedList.push({
        chunkId,
        runbookId: item.chunkData.runbookId,
        serviceName: item.chunkData.serviceName,
        fileName: item.chunkData.fileName,
        headerPath: item.chunkData.headerPath,
        headerContext: item.chunkData.headerContext,
        anchor: item.chunkData.anchor,
        chunkText: item.chunkData.chunkText,
        cosineSimilarity: item.cosineSimilarity,
        keywordRank: item.keywordRank,
        vectorRank: item.vectorRank,
        fusedScore,
        retrievalSources: Array.from(item.sources)
      });
    }

    // Sort descending by fusedScore (then by cosineSimilarity)
    fusedList.sort((a, b) => b.fusedScore - a.fusedScore || b.cosineSimilarity - a.cosineSimilarity);

    const topKChunks = fusedList.slice(0, this.topK);

    return {
      chunks: topKChunks,
      totalCandidatesEvaluated: mergedMap.size
    };
  }

  private async searchKeywords(
    input: RetrievalInput,
    serviceFilter?: string
  ): Promise<
    Array<{
      chunkId: string;
      runbookId: string;
      serviceName: string;
      fileName: string;
      headerPath: string[];
      headerContext: string;
      anchor: string;
      chunkText: string;
      score: number;
    }>
  > {
    // Construct $text search terms
    const phraseTerms = input.errorTokens.map((t) => `"${t.replace(/"/g, '')}"`);
    const wordTerms = [...input.techKeywords];
    const signatureWords = input.signature
      .split(/[^a-zA-Z0-9_-]+/)
      .filter((w) => w.length > 3)
      .slice(0, 5);

    const queryTerms = [...phraseTerms, ...wordTerms, ...signatureWords].join(' ').trim();
    if (!queryTerms) {
      return [];
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filter: any = { $text: { $search: queryTerms } };
      if (serviceFilter) {
        filter.serviceName = serviceFilter;
      }

      const docs = await RunbookChunk.find(
        filter,
        { score: { $meta: 'textScore' } }
      )
        .sort({ score: { $meta: 'textScore' } })
        .limit(20)
        .lean<Array<IRunbookChunk & { score: number }>>();

      return docs.map((doc) => ({
        chunkId: (doc._id as mongoose.Types.ObjectId).toString(),
        runbookId: doc.runbookId.toString(),
        serviceName: doc.serviceName,
        fileName: doc.fileName,
        headerPath: doc.headerPath,
        headerContext: doc.headerContext,
        anchor: doc.anchor,
        chunkText: doc.chunkText,
        score: doc.score || 0
      }));
    } catch (err) {
      // In-memory or environments without text index ready
      logger.warn({ err }, 'MongoDB $text search error; falling back to in-memory keyword matching');
      return this.fallbackInMemoryKeywordSearch(input, serviceFilter);
    }
  }

  private async fallbackInMemoryKeywordSearch(
    input: RetrievalInput,
    serviceFilter?: string
  ) {
    const allChunks = await runbookMemoryCache.getChunks();
    const filtered = serviceFilter ? allChunks.filter((c) => c.serviceName === serviceFilter) : allChunks;
    const searchTerms = [
      ...input.errorTokens.map((t) => t.toLowerCase()),
      ...input.techKeywords.map((t) => t.toLowerCase())
    ];

    const scored = filtered.map((c) => {
      let score = 0;
      const hText = c.headerContext.toLowerCase();
      const bText = c.chunkText.toLowerCase();

      for (const term of searchTerms) {
        if (hText.includes(term)) score += 3;
        if (bText.includes(term)) score += 1;
      }
      return {
        chunkId: c.id,
        runbookId: c.runbookId,
        serviceName: c.serviceName,
        fileName: c.fileName,
        headerPath: c.headerPath,
        headerContext: c.headerContext,
        anchor: c.anchor,
        chunkText: c.chunkText,
        score
      };
    });

    return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 20);
  }

  private async searchVector(
    input: RetrievalInput,
    serviceFilter?: string
  ): Promise<
    Array<{
      chunkId: string;
      runbookId: string;
      serviceName: string;
      fileName: string;
      headerPath: string[];
      headerContext: string;
      anchor: string;
      chunkText: string;
      cosineSimilarity: number;
    }>
  > {
    const queryText = `${input.signature}\n\n${input.sanitizedLog.slice(0, 1500)}`.trim();
    const queryVector = await this.embeddingService.embedQuery(queryText);

    if (env.RETRIEVAL_MODE === 'atlas') {
      try {
        const pipeline: unknown[] = [
          {
            $vectorSearch: {
              index: VECTOR_INDEX_NAME,
              path: 'embedding',
              queryVector,
              numCandidates: 200,
              limit: 20,
              ...(serviceFilter ? { filter: { serviceName: serviceFilter } } : {})
            }
          },
          {
            $project: {
              _id: 1,
              runbookId: 1,
              serviceName: 1,
              fileName: 1,
              headerPath: 1,
              headerContext: 1,
              anchor: 1,
              chunkText: 1,
              score: { $meta: 'vectorSearchScore' }
            }
          }
        ];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const results = await RunbookChunk.aggregate(pipeline as any);
        return results.map((doc) => ({
          chunkId: doc._id.toString(),
          runbookId: doc.runbookId.toString(),
          serviceName: doc.serviceName,
          fileName: doc.fileName,
          headerPath: doc.headerPath,
          headerContext: doc.headerContext,
          anchor: doc.anchor,
          chunkText: doc.chunkText,
          cosineSimilarity: doc.score || 0
        }));
      } catch (err) {
        logger.warn({ err }, 'Atlas $vectorSearch failed; falling back to in-memory cosine search');
      }
    }

    // Default: in-memory cosine search
    const allChunks = await runbookMemoryCache.getChunks();
    const candidates = serviceFilter
      ? allChunks.filter((c) => c.serviceName === serviceFilter)
      : allChunks;

    const scored = candidates.map((chunk) => {
      const cosine = computeCosineSimilarity(queryVector, chunk.embedding);
      return {
        chunkId: chunk.id,
        runbookId: chunk.runbookId,
        serviceName: chunk.serviceName,
        fileName: chunk.fileName,
        headerPath: chunk.headerPath,
        headerContext: chunk.headerContext,
        anchor: chunk.anchor,
        chunkText: chunk.chunkText,
        cosineSimilarity: Number(cosine.toFixed(4))
      };
    });

    return scored.sort((a, b) => b.cosineSimilarity - a.cosineSimilarity).slice(0, 20);
  }
}
