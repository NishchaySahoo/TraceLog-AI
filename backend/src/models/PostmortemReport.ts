import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

export interface IMitigationStep {
  step: string;
  refs: number[];
  unverified?: boolean;
}

export interface ICitation {
  ref: number;
  chunkId: Types.ObjectId;
  runbookId: Types.ObjectId;
  fileName: string;
  headerContext: string;
  anchor: string;
  snippet: string;
  cosineSimilarity: number;
  fusedScore: number;
}

export interface IPostmortemReport extends Document {
  incidentId: Types.ObjectId;
  summary: string;
  probableRootCause: string;
  immediateMitigation: IMitigationStep[];
  longTermFixes: IMitigationStep[];
  hypotheses: string[];
  confidence: number;
  insufficientContext: boolean;
  citations: ICitation[];
  llmProvider: string;
  llmModel: string;
  latencyMs: number;
  createdAt: Date;
  updatedAt: Date;
}

const MitigationStepSchema = new Schema<IMitigationStep>(
  {
    step: { type: String, required: true },
    refs: { type: [Number], default: [] },
    unverified: { type: Boolean, default: false }
  },
  { _id: false }
);

const CitationSchema = new Schema<ICitation>(
  {
    ref: { type: Number, required: true },
    chunkId: { type: Schema.Types.ObjectId, ref: 'RunbookChunk', required: true },
    runbookId: { type: Schema.Types.ObjectId, ref: 'Runbook', required: true },
    fileName: { type: String, required: true },
    headerContext: { type: String, required: true },
    anchor: { type: String, required: true },
    snippet: { type: String, required: true },
    cosineSimilarity: { type: Number, required: true },
    fusedScore: { type: Number, required: true }
  },
  { _id: false }
);

const PostmortemReportSchema = new Schema<IPostmortemReport>(
  {
    incidentId: {
      type: Schema.Types.ObjectId,
      ref: 'IncidentLog',
      required: true,
      index: true
    },
    summary: { type: String, required: true },
    probableRootCause: { type: String, required: true },
    immediateMitigation: { type: [MitigationStepSchema], default: [] },
    longTermFixes: { type: [MitigationStepSchema], default: [] },
    hypotheses: { type: [String], default: [] },
    confidence: { type: Number, required: true, min: 0, max: 100 },
    insufficientContext: { type: Boolean, default: false },
    citations: { type: [CitationSchema], default: [] },
    llmProvider: { type: String, required: true },
    llmModel: { type: String, required: true },
    latencyMs: { type: Number, required: true }
  },
  {
    timestamps: true
  }
);

export const PostmortemReport: Model<IPostmortemReport> =
  mongoose.models.PostmortemReport ||
  mongoose.model<IPostmortemReport>('PostmortemReport', PostmortemReportSchema);
