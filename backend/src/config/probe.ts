import type { EmbeddingProvider } from '../providers/types';
import { logger } from './logger';

export async function probeEmbeddingDimension(provider: EmbeddingProvider, expectedDim: number): Promise<void> {
  logger.info({ provider: provider.name, expectedDim }, 'Probing embedding provider dimension...');
  const probeVector = await provider.embedQuery('probe');

  if (probeVector.length !== expectedDim) {
    const errorMsg = `FATAL: Embedding dimension mismatch! Provider "${provider.name}" returned ${probeVector.length} dimensions, but EMBEDDING_DIM is configured to ${expectedDim}.`;
    logger.fatal(errorMsg);
    throw new Error(errorMsg);
  }

  logger.info({ dimension: probeVector.length }, 'Embedding dimension verification succeeded');
}
