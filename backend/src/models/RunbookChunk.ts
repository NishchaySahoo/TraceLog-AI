import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

export interface IRunbookChunk extends Document {
  runbookId: Types.ObjectId;
  serviceName: string;
  fileName: string;
  headerPath: string[];
  headerContext: string;
  anchor: string;
  chunkText: string;
  embedding: number[];
  createdAt: Date;
  updatedAt: Date;
}

const RunbookChunkSchema = new Schema<IRunbookChunk>(
  {
    runbookId: { type: Schema.Types.ObjectId, ref: 'Runbook', required: true, index: true },
    serviceName: { type: String, required: true, index: true },
    fileName: { type: String, required: true },
    headerPath: { type: [String], default: [] },
    headerContext: { type: String, required: true },
    anchor: { type: String, required: true },
    chunkText: { type: String, required: true },
    embedding: { type: [Number], required: true }
  },
  {
    timestamps: true
  }
);

// Compound text index on headerContext and chunkText with weights 3 and 1
RunbookChunkSchema.index(
  { headerContext: 'text', chunkText: 'text' },
  { weights: { headerContext: 3, chunkText: 1 }, name: 'header_chunk_text_idx' }
);

export const RunbookChunk: Model<IRunbookChunk> =
  mongoose.models.RunbookChunk || mongoose.model<IRunbookChunk>('RunbookChunk', RunbookChunkSchema);
