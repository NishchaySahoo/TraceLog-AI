import { createApp } from './app';
import { env } from './config/env';
import { connectDB, disconnectDB } from './config/db';
import { logger } from './config/logger';
import { createEmbeddingProvider } from './providers/embedding';
import { probeEmbeddingDimension } from './config/probe';
import type { Server } from 'node:http';

async function bootstrap(): Promise<Server> {
  logger.info({ env: env.NODE_ENV, port: env.PORT }, 'Starting TraceLog AI Backend...');

  // 1. Startup embedding probe
  try {
    const embeddingProvider = createEmbeddingProvider(env);
    await probeEmbeddingDimension(embeddingProvider, env.EMBEDDING_DIM);
  } catch (error) {
    logger.fatal({ err: error }, 'Startup probe failed. Halting application.');
    process.exit(1);
  }

  // 2. Connect to Database
  try {
    await connectDB(env.MONGO_URI);
  } catch (error) {
    logger.fatal({ err: error }, 'Database connection failed. Halting application.');
    process.exit(1);
  }

  // 3. Create and start HTTP server
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`TraceLog AI Backend running on http://localhost:${env.PORT}`);
    logger.info(`Health check at: http://localhost:${env.PORT}/api/v1/health`);
  });

  // 4. Graceful shutdown listeners
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Graceful shutdown signal received');
    server.close(async () => {
      logger.info('HTTP server closed');
      try {
        await disconnectDB();
        logger.info('Shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
    });

    // Force exit after 10s if stuck
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

// Only start when invoked directly
if (process.env.NODE_ENV !== 'test') {
  bootstrap().catch((err) => {
    logger.fatal({ err }, 'Unhandled exception during bootstrap');
    process.exit(1);
  });
}
