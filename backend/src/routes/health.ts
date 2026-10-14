import { Router, type Request, type Response } from 'express';
import { isDBConnected } from '../config/db';
import { env } from '../config/env';

export const healthRouter = Router();

healthRouter.get('/health', (_req: Request, res: Response) => {
  const mongoStatus = isDBConnected() ? 'connected' : 'disconnected';
  const status = mongoStatus === 'connected' ? 'ok' : 'degraded';

  res.status(status === 'ok' ? 200 : 503).json({
    status,
    mongo: mongoStatus,
    retrievalMode: env.RETRIEVAL_MODE,
    embeddingProvider: env.EMBEDDING_PROVIDER,
    llmProvider: env.LLM_PROVIDER,
    timestamp: new Date().toISOString()
  });
});
