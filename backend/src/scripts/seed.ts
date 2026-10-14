import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDB, disconnectDB } from '../config/db';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { createEmbeddingProvider } from '../providers/embedding';
import { EmbeddingService } from '../services/embedding.service';
import { ingestRunbook } from '../services/runbook.service';
import { ensureIndex } from '../config/vectorIndex';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function seedRunbooks(runbooksDir?: string): Promise<number> {
  const targetDir =
    runbooksDir || path.resolve(__dirname, '../../../samples/runbooks');

  logger.info({ targetDir }, 'Seeding runbooks from directory...');

  const files = await fs.readdir(targetDir);
  const mdFiles = files.filter((f) => f.endsWith('.md'));

  if (mdFiles.length === 0) {
    logger.warn('No .md runbook files found to seed');
    return 0;
  }

  const embeddingProvider = createEmbeddingProvider(env);
  const embeddingService = new EmbeddingService(embeddingProvider);

  await ensureIndex();

  let totalChunksIngested = 0;
  for (const file of mdFiles) {
    const filePath = path.join(targetDir, file);
    const content = await fs.readFile(filePath, 'utf-8');
    const result = await ingestRunbook(file, content, embeddingService);

    logger.info(
      {
        fileName: file,
        service: result.runbook.serviceName,
        totalChunks: result.totalChunks,
        skipped: result.skipped
      },
      `Processed ${file}`
    );
    totalChunksIngested += result.totalChunks;
  }

  logger.info({ runbooksCount: mdFiles.length, totalChunksIngested }, 'Runbook seeding completed successfully');
  return totalChunksIngested;
}

// Direct invocation check
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  (async () => {
    try {
      await connectDB(env.MONGO_URI);
      await seedRunbooks();
      await disconnectDB();
      process.exit(0);
    } catch (err) {
      logger.fatal({ err }, 'Seed script failed');
      process.exit(1);
    }
  })();
}
