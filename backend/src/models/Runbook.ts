import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface IRunbook extends Document {
  serviceName: string;
  fileName: string;
  content: string;
  contentHash: string;
  tags: string[];
  totalChunks: number;
  embeddingModel: string;
  embeddingDim: number;
  createdAt: Date;
  updatedAt: Date;
}

const RunbookSchema = new Schema<IRunbook>(
  {
    serviceName: { type: String, required: true, index: true },
    fileName: { type: String, required: true },
    content: { type: String, required: true },
    contentHash: { type: String, required: true, index: true },
    tags: { type: [String], default: [] },
    totalChunks: { type: Number, required: true, default: 0 },
    embeddingModel: { type: String, required: true },
    embeddingDim: { type: Number, required: true }
  },
  {
    timestamps: true
  }
);

RunbookSchema.index({ serviceName: 1, fileName: 1 }, { unique: true });

export const Runbook: Model<IRunbook> =
  mongoose.models.Runbook || mongoose.model<IRunbook>('Runbook', RunbookSchema);
