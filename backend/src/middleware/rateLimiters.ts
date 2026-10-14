import rateLimit from 'express-rate-limit';
import { AppError } from './errorHandler';

export const triageRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new AppError(429, 'RATE_LIMIT_EXCEEDED', 'Triage rate limit exceeded. Please wait before submitting more logs.'));
  }
});

export const uploadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new AppError(429, 'RATE_LIMIT_EXCEEDED', 'Runbook upload rate limit exceeded. Please wait before uploading more files.'));
  }
});
