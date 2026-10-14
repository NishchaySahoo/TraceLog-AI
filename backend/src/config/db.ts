import mongoose from 'mongoose';
import { logger } from './logger';

export async function connectDB(uri: string): Promise<typeof mongoose> {
  try {
    const conn = await mongoose.connect(uri);
    logger.info({ uri: uri.replace(/\/\/.*@/, '//<redacted>@') }, 'Connected to MongoDB');
    return conn;
  } catch (error) {
    logger.error({ err: error }, 'Failed to connect to MongoDB');
    throw error;
  }
}

export async function disconnectDB(): Promise<void> {
  try {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB');
  } catch (error) {
    logger.error({ err: error }, 'Error disconnecting from MongoDB');
    throw error;
  }
}

export function isDBConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
