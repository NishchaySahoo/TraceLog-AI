import express, { type Express, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './config/logger';
import { requestIdMiddleware } from './middleware/requestId';
import { errorHandler, AppError } from './middleware/errorHandler';
import { healthRouter } from './routes/health';
import { runbooksRouter } from './routes/runbooks';
import { incidentsRouter } from './routes/incidents';

export function createApp(): Express {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS configuration
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, or tests)
        if (!origin || env.CORS_ORIGINS.includes('*') || env.CORS_ORIGINS.includes(origin)) {
          callback(null, true);
        } else {
          callback(new AppError(403, 'CORS_ERROR', `Origin ${origin} not allowed by CORS`));
        }
      },
      credentials: true
    })
  );

  // Request ID
  app.use(requestIdMiddleware);

  // Structured HTTP logging (skip during test runs)
  if (env.NODE_ENV !== 'test') {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => (req as Request).id || 'unknown'
      })
    );
  }

  // Rate Limiting - global
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, _res, next) => {
      next(new AppError(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests, please try again later.'));
    }
  });
  app.use(globalLimiter);

  // Body parser with size limits
  app.use(express.json({ limit: `${env.MAX_LOG_BYTES * 2}b` }));
  app.use(express.urlencoded({ extended: true, limit: `${env.MAX_LOG_BYTES * 2}b` }));

  // API Routes
  app.use('/api/v1', healthRouter);
  app.use('/api/v1', runbooksRouter);
  app.use('/api/v1', incidentsRouter);

  // 404 Handler
  app.use((req: Request, _res: Response, next) => {
    next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`));
  });

  // Global Error Handler
  app.use(errorHandler);

  return app;
}
