import mongoose from 'mongoose';
import { env } from './env';
import { logger } from './logger';

export const VECTOR_INDEX_NAME = 'vector_index_runbook_chunks';

export async function ensureIndex(): Promise<void> {
  if (env.RETRIEVAL_MODE !== 'atlas') {
    logger.debug('RETRIEVAL_MODE is not atlas; skipping Atlas Search index creation');
    return;
  }

  try {
    const db = mongoose.connection.db;
    if (!db) {
      logger.warn('Cannot ensure Atlas vector index: DB connection is not initialized');
      return;
    }

    const collection = db.collection('runbookchunks');

    // List existing search indexes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cursor = (collection as any).listSearchIndexes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const searchIndexes = await cursor.toArray().catch(() => [] as any[]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exists = searchIndexes.some((idx: any) => idx.name === VECTOR_INDEX_NAME);
    if (exists) {
      logger.info({ indexName: VECTOR_INDEX_NAME }, 'Atlas Vector Search index already exists');
      return;
    }

    logger.info({ indexName: VECTOR_INDEX_NAME }, 'Creating Atlas Vector Search index...');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (collection as any).createSearchIndex({
      name: VECTOR_INDEX_NAME,
      type: 'vectorSearch',
      definition: {
        fields: [
          {
            type: 'vector',
            path: 'embedding',
            numDimensions: env.EMBEDDING_DIM,
            similarity: 'cosine'
          },
          {
            type: 'filter',
            path: 'serviceName'
          }
        ]
      }
    });

    logger.info({ indexName: VECTOR_INDEX_NAME }, 'Atlas Vector Search index created successfully');
  } catch (err) {
    logger.warn({ err }, 'Could not automatically create Atlas Search index (this requires Atlas environment)');
  }
}
