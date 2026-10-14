import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Runbook, type IRunbook } from '../models/Runbook';
import { RunbookChunk, type IRunbookChunk } from '../models/RunbookChunk';
import { chunkMarkdown } from './chunker.service';
import type { EmbeddingService } from './embedding.service';
import { env } from '../config/env';
import { logger } from '../config/logger';

export interface IngestRunbookResult {
  runbook: IRunbook;
  skipped: boolean;
  totalChunks: number;
}

export interface CachedChunk {
  id: string;
  runbookId: string;
  serviceName: string;
  fileName: string;
  headerPath: string[];
  headerContext: string;
  anchor: string;
  chunkText: string;
  embedding: number[];
  norm: number;
}

class RunbookMemoryCache {
  private cache: CachedChunk[] | null = null;

  public invalidate(): void {
    this.cache = null;
    logger.debug('Runbook memory cache invalidated');
  }

  public async getChunks(): Promise<CachedChunk[]> {
    if (this.cache !== null) {
      return this.cache;
    }

    const docs = await RunbookChunk.find({}).lean<IRunbookChunk[]>();
    this.cache = docs.map((doc) => {
      let sumSq = 0;
      for (const val of doc.embedding) {
        sumSq += val * val;
      }
      const norm = Math.sqrt(sumSq) || 1;

      return {
        id: (doc._id as mongoose.Types.ObjectId).toString(),
        runbookId: doc.runbookId.toString(),
        serviceName: doc.serviceName,
        fileName: doc.fileName,
        headerPath: doc.headerPath,
        headerContext: doc.headerContext,
        anchor: doc.anchor,
        chunkText: doc.chunkText,
        embedding: doc.embedding,
        norm
      };
    });

    logger.debug({ count: this.cache.length }, 'Runbook memory cache refreshed');
    return this.cache;
  }
}

export const runbookMemoryCache = new RunbookMemoryCache();

export async function ingestRunbook(
  fileName: string,
  content: string,
  embeddingService: EmbeddingService,
  serviceNameOverride?: string
): Promise<IngestRunbookResult> {
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');
  const parsed = chunkMarkdown(content, { serviceName: serviceNameOverride });
  const serviceName = parsed.serviceName;

  // Check if runbook exists
  const existing = await Runbook.findOne({ serviceName, fileName });
  if (existing && existing.contentHash === contentHash) {
    logger.info({ serviceName, fileName }, 'Runbook unchanged; skipping re-indexing');
    return {
      runbook: existing,
      skipped: true,
      totalChunks: existing.totalChunks
    };
  }

  logger.info({ serviceName, fileName, chunksCount: parsed.chunks.length }, 'Indexing runbook chunks...');

  // Step 1: Generate embeddings before database modification (rollback guard)
  const chunkTextsToEmbed = parsed.chunks.map((c) => c.embeddedText);
  let embeddings: number[][];
  try {
    embeddings = await embeddingService.embedBatch(chunkTextsToEmbed);
  } catch (err) {
    logger.error({ err, serviceName, fileName }, 'Failed to generate embeddings during runbook ingestion; aborting');
    throw err;
  }

  // Step 2: Database transaction / atomic replacement
  let runbookDoc: IRunbook;

  if (existing) {
    // Delete old chunks
    await RunbookChunk.deleteMany({ runbookId: existing._id });

    existing.content = content;
    existing.contentHash = contentHash;
    existing.tags = parsed.tags;
    existing.totalChunks = parsed.chunks.length;
    existing.embeddingModel = env.EMBEDDING_MODEL;
    existing.embeddingDim = env.EMBEDDING_DIM;
    runbookDoc = await existing.save();
  } else {
    runbookDoc = await Runbook.create({
      serviceName,
      fileName,
      content,
      contentHash,
      tags: parsed.tags,
      totalChunks: parsed.chunks.length,
      embeddingModel: env.EMBEDDING_MODEL,
      embeddingDim: env.EMBEDDING_DIM
    });
  }

  // Step 3: Insert new chunks
  const chunkDocs = parsed.chunks.map((chunk, idx) => ({
    runbookId: runbookDoc._id,
    serviceName,
    fileName,
    headerPath: chunk.headerPath,
    headerContext: chunk.headerContext,
    anchor: chunk.anchor,
    chunkText: chunk.chunkText,
    embedding: embeddings[idx]
  }));

  if (chunkDocs.length > 0) {
    await RunbookChunk.insertMany(chunkDocs);
  }

  // Step 4: Invalidate in-memory cache
  runbookMemoryCache.invalidate();

  logger.info({ serviceName, fileName, totalChunks: parsed.chunks.length }, 'Runbook indexed successfully');
  return {
    runbook: runbookDoc,
    skipped: false,
    totalChunks: parsed.chunks.length
  };
}

export async function deleteRunbook(runbookId: string): Promise<boolean> {
  const runbook = await Runbook.findById(runbookId);
  if (!runbook) return false;

  await RunbookChunk.deleteMany({ runbookId: runbook._id });
  await Runbook.deleteOne({ _id: runbook._id });

  runbookMemoryCache.invalidate();
  logger.info({ runbookId }, 'Runbook and associated chunks deleted');
  return true;
}
