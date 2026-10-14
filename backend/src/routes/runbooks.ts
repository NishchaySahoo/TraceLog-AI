import { Router, type Request, type Response, type NextFunction } from 'express';
import { uploadRunbook } from '../middleware/upload';
import { uploadRateLimiter } from '../middleware/rateLimiters';
import { AppError } from '../middleware/errorHandler';
import { Runbook } from '../models/Runbook';
import { RunbookChunk } from '../models/RunbookChunk';
import { ingestRunbook, deleteRunbook } from '../services/runbook.service';
import { createEmbeddingProvider } from '../providers/embedding';
import { EmbeddingService } from '../services/embedding.service';
import { env } from '../config/env';

export const runbooksRouter = Router();

const embeddingProvider = createEmbeddingProvider(env);
const embeddingService = new EmbeddingService(embeddingProvider);

// POST /runbooks/upload
runbooksRouter.post(
  '/runbooks/upload',
  uploadRateLimiter,
  uploadRunbook.single('file'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) {
        throw new AppError(400, 'FILE_MISSING', 'A markdown runbook file is required');
      }

      // Strip null bytes and decode as UTF-8
      const rawContent = req.file.buffer.toString('utf-8').replace(/\0/g, '');
      if (rawContent.trim().length === 0) {
        throw new AppError(400, 'FILE_EMPTY', 'Uploaded runbook file is empty');
      }

      const serviceNameOverride = typeof req.body.serviceName === 'string' && req.body.serviceName.trim()
        ? req.body.serviceName.trim()
        : undefined;

      const result = await ingestRunbook(
        req.file.originalname,
        rawContent,
        embeddingService,
        serviceNameOverride
      );

      res.status(result.skipped ? 200 : 201).json({
        runbook: {
          id: result.runbook._id.toString(),
          serviceName: result.runbook.serviceName,
          fileName: result.runbook.fileName,
          tags: result.runbook.tags,
          totalChunks: result.totalChunks,
          embeddingModel: result.runbook.embeddingModel,
          embeddingDim: result.runbook.embeddingDim,
          createdAt: result.runbook.createdAt.toISOString(),
          updatedAt: result.runbook.updatedAt.toISOString()
        },
        skipped: result.skipped,
        totalChunks: result.totalChunks
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /runbooks
runbooksRouter.get(
  '/runbooks',
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const runbooks = await Runbook.find().sort({ updatedAt: -1 }).lean();

      res.status(200).json({
        runbooks: runbooks.map((rb) => ({
          id: rb._id.toString(),
          serviceName: rb.serviceName,
          fileName: rb.fileName,
          tags: rb.tags,
          totalChunks: rb.totalChunks,
          embeddingModel: rb.embeddingModel,
          embeddingDim: rb.embeddingDim,
          createdAt: rb.createdAt.toISOString(),
          updatedAt: rb.updatedAt.toISOString()
        }))
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /runbooks/:id
runbooksRouter.get(
  '/runbooks/:id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const runbook = await Runbook.findById(req.params.id).lean();
      if (!runbook) {
        throw new AppError(404, 'NOT_FOUND', `Runbook with ID ${req.params.id} not found`);
      }

      // Return chunks with headers, but omit raw embeddings
      const chunks = await RunbookChunk.find({ runbookId: runbook._id })
        .select('-embedding')
        .lean();

      res.status(200).json({
        runbook: {
          id: runbook._id.toString(),
          serviceName: runbook.serviceName,
          fileName: runbook.fileName,
          content: runbook.content,
          tags: runbook.tags,
          totalChunks: runbook.totalChunks,
          embeddingModel: runbook.embeddingModel,
          embeddingDim: runbook.embeddingDim,
          createdAt: runbook.createdAt.toISOString(),
          updatedAt: runbook.updatedAt.toISOString()
        },
        chunks: chunks.map((c) => ({
          id: c._id.toString(),
          headerPath: c.headerPath,
          headerContext: c.headerContext,
          anchor: c.anchor,
          chunkText: c.chunkText
        }))
      });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /runbooks/:id
runbooksRouter.delete(
  '/runbooks/:id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const deleted = await deleteRunbook(id);
      if (!deleted) {
        throw new AppError(404, 'NOT_FOUND', `Runbook with ID ${id} not found`);
      }

      res.status(200).json({
        success: true,
        message: 'Runbook and associated chunks deleted successfully'
      });
    } catch (err) {
      next(err);
    }
  }
);
