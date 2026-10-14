import multer from 'multer';
import path from 'node:path';
import { env } from '../config/env';
import { AppError } from './errorHandler';

const storage = multer.memoryStorage();

export const uploadRunbook = multer({
  storage,
  limits: {
    fileSize: env.MAX_RUNBOOK_BYTES
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const validExtensions = ['.md', '.txt', '.markdown'];
    const validMimes = ['text/markdown', 'text/plain', 'application/octet-stream'];

    if (validExtensions.includes(ext) || validMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new AppError(
          400,
          'INVALID_FILE_TYPE',
          `Invalid file type "${ext || file.mimetype}". Only .md and .txt Markdown files are accepted.`
        )
      );
    }
  }
});
