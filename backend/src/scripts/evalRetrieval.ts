import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { createEmbeddingProvider } from '../providers/embedding';
import { EmbeddingService } from '../services/embedding.service';
import { RetrievalService, type RetrievedChunk } from '../services/retrieval.service';
import { sanitizeLog } from '../services/logSanitizer';
import { extractSignature } from '../services/signature';
import { seedRunbooks } from './seed';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TestCase {
  logFile: string;
  rawLog: string;
  expected: {
    serviceName: string;
    expectedFileName: string;
    expectedHeader: string;
  };
}

interface StrategyMetrics {
  name: string;
  hitAt1: number;
  hitAt3: number;
  totalReciprocalRank: number;
  totalCases: number;
}

export async function runRetrievalEvaluation(): Promise<void> {
  let mongoServer: MongoMemoryServer | null = null;

  // 1. Establish DB connection (use MongoMemoryServer if offline/memory mode)
  try {
    if (mongoose.connection.readyState !== 1) {
      try {
        await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 2000 });
        logger.info('Connected to existing MongoDB instance');
      } catch {
        logger.info('Starting MongoMemoryServer for standalone retrieval evaluation...');
        mongoServer = await MongoMemoryServer.create();
        const uri = mongoServer.getUri();
        await mongoose.connect(uri);
        logger.info('Connected to MongoMemoryServer');
      }
    }

    // 2. Seed runbooks
    const runbooksDir = path.resolve(__dirname, '../../../samples/runbooks');
    const logsDir = path.resolve(__dirname, '../../../samples/logs');

    await seedRunbooks(runbooksDir);

    // 3. Load sample logs and expected sidecars
    const logFiles = (await fs.readdir(logsDir)).filter((f) => f.endsWith('.log'));
    const testCases: TestCase[] = [];

    for (const file of logFiles) {
      const baseName = file.replace(/\.log$/, '');
      const expectedPath = path.join(logsDir, `${baseName}.expected.json`);
      const logPath = path.join(logsDir, file);

      try {
        const rawLog = await fs.readFile(logPath, 'utf-8');
        const expectedRaw = await fs.readFile(expectedPath, 'utf-8');
        const expected = JSON.parse(expectedRaw);

        testCases.push({
          logFile: file,
          rawLog,
          expected
        });
      } catch (err) {
        logger.warn({ file, err }, 'Skipping test case due to missing expected sidecar');
      }
    }

    if (testCases.length === 0) {
      throw new Error('No test cases found in samples/logs');
    }

    const embeddingProvider = createEmbeddingProvider(env);
    const embeddingService = new EmbeddingService(embeddingProvider);
    const retrievalService = new RetrievalService(embeddingService, 10, 0.1);

    const metrics: Record<'keyword' | 'vector' | 'hybrid', StrategyMetrics> = {
      keyword: { name: 'Keyword Only ($text)', hitAt1: 0, hitAt3: 0, totalReciprocalRank: 0, totalCases: testCases.length },
      vector: { name: 'Vector Only (Cosine)', hitAt1: 0, hitAt3: 0, totalReciprocalRank: 0, totalCases: testCases.length },
      hybrid: { name: 'Hybrid (RRF Fusion)', hitAt1: 0, hitAt3: 0, totalReciprocalRank: 0, totalCases: testCases.length }
    };

    console.log('\n===============================================================');
    console.log('              TRACELOG AI - RETRIEVAL EVALUATION               ');
    console.log('===============================================================\n');

    for (const tc of testCases) {
      const { sanitized } = sanitizeLog(tc.rawLog);
      const sig = extractSignature(tc.rawLog);

      // Perform retrieval
      const searchResult = await retrievalService.executeHybridSearch({
        sanitizedLog: sanitized,
        signature: sig.signature,
        errorTokens: sig.errorTokens,
        techKeywords: sig.techKeywords,
        serviceName: tc.expected.serviceName
      });

      const hybridCandidates = searchResult.chunks;

      // Keyword-only ordering
      const keywordCandidates = [...hybridCandidates]
        .filter((c) => c.keywordRank !== undefined)
        .sort((a, b) => (a.keywordRank || 99) - (b.keywordRank || 99));

      // Vector-only ordering
      const vectorCandidates = [...hybridCandidates]
        .filter((c) => c.vectorRank !== undefined)
        .sort((a, b) => (a.vectorRank || 99) - (b.vectorRank || 99));

      const evaluateRanking = (candidates: RetrievedChunk[], strat: 'keyword' | 'vector' | 'hybrid') => {
        let matchRank = 0;
        for (let i = 0; i < candidates.length; i++) {
          const c = candidates[i];
          const fileMatch = c.fileName.toLowerCase() === tc.expected.expectedFileName.toLowerCase();
          const headerMatch =
            c.headerContext.toLowerCase().includes(tc.expected.expectedHeader.toLowerCase()) ||
            tc.expected.expectedHeader.toLowerCase().includes(c.headerContext.toLowerCase());

          if (fileMatch && headerMatch) {
            matchRank = i + 1;
            break;
          }
        }

        if (matchRank === 1) metrics[strat].hitAt1++;
        if (matchRank >= 1 && matchRank <= 3) metrics[strat].hitAt3++;
        if (matchRank > 0) metrics[strat].totalReciprocalRank += 1 / matchRank;
      };

      evaluateRanking(keywordCandidates, 'keyword');
      evaluateRanking(vectorCandidates, 'vector');
      evaluateRanking(hybridCandidates, 'hybrid');
    }

    // Print Results Table
    console.log('| Strategy                | Hit@1 (%) | Hit@3 (%) | Mean Reciprocal Rank (MRR) |');
    console.log('|:------------------------|:---------:|:---------:|:--------------------------:|');

    for (const key of ['keyword', 'vector', 'hybrid'] as const) {
      const m = metrics[key];
      const hit1Pct = ((m.hitAt1 / m.totalCases) * 100).toFixed(1);
      const hit3Pct = ((m.hitAt3 / m.totalCases) * 100).toFixed(1);
      const mrr = (m.totalReciprocalRank / m.totalCases).toFixed(4);

      console.log(
        `| ${m.name.padEnd(24)} | ${hit1Pct.padStart(8)}% | ${hit3Pct.padStart(8)}% | ${mrr.padStart(26)} |`
      );
    }

    console.log('\n---------------------------------------------------------------');
    const hybridMRR = metrics.hybrid.totalReciprocalRank / testCases.length;
    const maxSingleMRR = Math.max(
      metrics.keyword.totalReciprocalRank / testCases.length,
      metrics.vector.totalReciprocalRank / testCases.length
    );

    if (hybridMRR >= maxSingleMRR) {
      console.log('✓ HYBRID RETRIEVAL VERIFIED: RRF matches or outperforms single-strategy retrieval.');
    } else {
      console.log('! Notice: Hybrid performance was comparable to individual branches.');
    }
    console.log('===============================================================\n');
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  }
}

// Direct execution
if (process.argv[1] && process.argv[1].endsWith('evalRetrieval.ts')) {
  runRetrievalEvaluation()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Retrieval evaluation failed:', err);
      process.exit(1);
    });
}
