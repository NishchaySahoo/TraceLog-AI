import { Router, type Request, type Response, type NextFunction } from 'express';
import { validateBody, validateQuery } from '../middleware/validate';
import {
  TriageRequestSchema,
  IncidentQuerySchema,
  IncidentStatusUpdateSchema
} from '../schemas/requests';
import { triageRateLimiter } from '../middleware/rateLimiters';
import { AppError } from '../middleware/errorHandler';
import { IncidentLog } from '../models/IncidentLog';
import { PostmortemReport } from '../models/PostmortemReport';
import { sanitizeLog } from '../services/logSanitizer';
import { extractSignature } from '../services/signature';
import { createEmbeddingProvider } from '../providers/embedding';
import { EmbeddingService } from '../services/embedding.service';
import { RetrievalService } from '../services/retrieval.service';
import { createLLMProvider } from '../providers/llm';
import { LLMService } from '../services/llm.service';
import { env } from '../config/env';

export const incidentsRouter = Router();

const embeddingProvider = createEmbeddingProvider(env);
const embeddingService = new EmbeddingService(embeddingProvider);
const retrievalService = new RetrievalService(embeddingService);
const llmProvider = createLLMProvider(env);
const llmService = new LLMService(llmProvider);

// POST /incidents/triage
incidentsRouter.post(
  '/incidents/triage',
  triageRateLimiter,
  validateBody(TriageRequestSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { rawLog, serviceName } = req.body;

      // 1. Sanitize
      const { sanitized, redactionCount } = sanitizeLog(rawLog, {
        maxBytes: env.MAX_LOG_BYTES
      });

      // 2. Extract signature
      const sig = extractSignature(rawLog);
      const effectiveService =
        serviceName?.trim() || sig.detectedService || 'unknown';

      // 3. Repeat incident detection
      const priors = await IncidentLog.find({ signatureHash: sig.signatureHash })
        .sort({ createdAt: -1 })
        .lean();
      const priorCount = priors.length;
      const lastSeenAt = priors[0]?.createdAt.toISOString();
      const lastIncidentId = priors[0]?._id.toString();

      // 4. Hybrid retrieval
      const retrievalResult = await retrievalService.retrieve({
        sanitizedLog: sanitized,
        signature: sig.signature,
        errorTokens: sig.errorTokens,
        techKeywords: sig.techKeywords,
        serviceName: effectiveService !== 'unknown' ? effectiveService : undefined
      });

      // 5. LLM Synthesis & Citation Enforcement
      let reportData;
      try {
        reportData = await llmService.synthesize(
          sanitized,
          sig.signature,
          retrievalResult.chunks
        );
      } catch (err) {
        // If LLM fails completely, record incident as OPEN before propagating error
        await IncidentLog.create({
          rawLog: env.STORE_RAW_LOGS ? rawLog : undefined,
          sanitizedLog: sanitized,
          redactionCount,
          errorSignature: sig.signature,
          signatureHash: sig.signatureHash,
          serviceName: effectiveService,
          severity: 'HIGH',
          status: 'OPEN'
        });
        throw err;
      }

      // 6. Persist IncidentLog
      const incident = await IncidentLog.create({
        rawLog: env.STORE_RAW_LOGS ? rawLog : undefined,
        sanitizedLog: sanitized,
        redactionCount,
        errorSignature: sig.signature,
        signatureHash: sig.signatureHash,
        serviceName: effectiveService,
        severity: reportData.severity,
        status: reportData.insufficientContext ? 'OPEN' : 'TRIAGED'
      });

      // 7. Persist PostmortemReport
      const report = await PostmortemReport.create({
        incidentId: incident._id,
        summary: reportData.summary,
        probableRootCause: reportData.probableRootCause,
        immediateMitigation: reportData.immediateMitigation,
        longTermFixes: reportData.longTermFixes,
        hypotheses: reportData.hypotheses,
        confidence: reportData.confidence,
        insufficientContext: reportData.insufficientContext,
        citations: reportData.citations,
        llmProvider: reportData.llmProvider,
        llmModel: reportData.llmModel,
        latencyMs: reportData.latencyMs
      });

      res.status(200).json({
        incident: {
          id: incident._id.toString(),
          serviceName: incident.serviceName,
          severity: incident.severity,
          status: incident.status,
          errorSignature: incident.errorSignature,
          signatureHash: incident.signatureHash,
          redactionCount: incident.redactionCount,
          rawLog: incident.rawLog,
          sanitizedLog: incident.sanitizedLog,
          createdAt: incident.createdAt.toISOString(),
          updatedAt: incident.updatedAt.toISOString()
        },
        report: {
          id: report._id.toString(),
          incidentId: report.incidentId.toString(),
          summary: report.summary,
          probableRootCause: report.probableRootCause,
          immediateMitigation: report.immediateMitigation,
          longTermFixes: report.longTermFixes,
          hypotheses: report.hypotheses,
          confidence: report.confidence,
          confidenceBreakdown: reportData.confidenceBreakdown,
          insufficientContext: report.insufficientContext,
          citations: report.citations,
          llmProvider: report.llmProvider,
          llmModel: report.llmModel,
          latencyMs: report.latencyMs,
          createdAt: report.createdAt.toISOString(),
          updatedAt: report.updatedAt.toISOString()
        },
        repeatInfo: {
          priorCount,
          lastSeenAt,
          lastIncidentId
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /incidents
incidentsRouter.get(
  '/incidents',
  validateQuery(IncidentQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, limit, severity, status, serviceName, q, includeRaw } = req.query as unknown as {
        page: number;
        limit: number;
        severity?: string;
        status?: string;
        serviceName?: string;
        q?: string;
        includeRaw?: boolean;
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filter: any = {};

      if (severity) filter.severity = severity;
      if (status) filter.status = status;
      if (serviceName) filter.serviceName = serviceName;
      if (q) {
        filter.$or = [
          { errorSignature: { $regex: q, $options: 'i' } },
          { sanitizedLog: { $regex: q, $options: 'i' } }
        ];
      }

      const total = await IncidentLog.countDocuments(filter);
      const query = IncidentLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

      if (!includeRaw) {
        query.select('-rawLog');
      }

      const items = await query.lean();

      res.status(200).json({
        incidents: items.map((inc) => ({
          id: inc._id.toString(),
          serviceName: inc.serviceName,
          severity: inc.severity,
          status: inc.status,
          errorSignature: inc.errorSignature,
          signatureHash: inc.signatureHash,
          redactionCount: inc.redactionCount,
          rawLog: inc.rawLog,
          sanitizedLog: inc.sanitizedLog,
          createdAt: inc.createdAt.toISOString(),
          updatedAt: inc.updatedAt.toISOString()
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /incidents/:id
incidentsRouter.get(
  '/incidents/:id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const includeRaw = req.query.includeRaw === 'true';
      const incident = await IncidentLog.findById(id).lean();

      if (!incident) {
        throw new AppError(404, 'NOT_FOUND', `Incident with ID ${id} not found`);
      }

      const report = await PostmortemReport.findOne({ incidentId: incident._id }).lean();

      res.status(200).json({
        incident: {
          id: incident._id.toString(),
          serviceName: incident.serviceName,
          severity: incident.severity,
          status: incident.status,
          errorSignature: incident.errorSignature,
          signatureHash: incident.signatureHash,
          redactionCount: incident.redactionCount,
          rawLog: includeRaw ? incident.rawLog : undefined,
          sanitizedLog: incident.sanitizedLog,
          createdAt: incident.createdAt.toISOString(),
          updatedAt: incident.updatedAt.toISOString()
        },
        report: report
          ? {
              id: report._id.toString(),
              incidentId: report.incidentId.toString(),
              summary: report.summary,
              probableRootCause: report.probableRootCause,
              immediateMitigation: report.immediateMitigation,
              longTermFixes: report.longTermFixes,
              hypotheses: report.hypotheses,
              confidence: report.confidence,
              insufficientContext: report.insufficientContext,
              citations: report.citations,
              llmProvider: report.llmProvider,
              llmModel: report.llmModel,
              latencyMs: report.latencyMs,
              createdAt: report.createdAt.toISOString(),
              updatedAt: report.updatedAt.toISOString()
            }
          : null
      });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /incidents/:id/status
incidentsRouter.patch(
  '/incidents/:id/status',
  validateBody(IncidentStatusUpdateSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const { status } = req.body;
      const incident = await IncidentLog.findByIdAndUpdate(
        id,
        { status },
        { new: true }
      );

      if (!incident) {
        throw new AppError(404, 'NOT_FOUND', `Incident with ID ${id} not found`);
      }

      res.status(200).json({
        id: incident._id.toString(),
        status: incident.status,
        updatedAt: incident.updatedAt.toISOString()
      });
    } catch (err) {
      next(err);
    }
  }
);
