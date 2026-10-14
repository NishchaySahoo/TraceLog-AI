import mongoose, { Schema, type Document, type Model } from 'mongoose';

export type IncidentSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type IncidentStatus = 'OPEN' | 'TRIAGED' | 'RESOLVED';

export interface IIncidentLog extends Document {
  rawLog?: string;
  sanitizedLog: string;
  redactionCount: number;
  errorSignature: string;
  signatureHash: string;
  serviceName: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  createdAt: Date;
  updatedAt: Date;
}

const IncidentLogSchema = new Schema<IIncidentLog>(
  {
    rawLog: { type: String },
    sanitizedLog: { type: String, required: true },
    redactionCount: { type: Number, required: true, default: 0 },
    errorSignature: { type: String, required: true },
    signatureHash: { type: String, required: true, index: true },
    serviceName: { type: String, default: 'unknown', index: true },
    severity: {
      type: String,
      enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
      default: 'MEDIUM',
      index: true
    },
    status: {
      type: String,
      enum: ['OPEN', 'TRIAGED', 'RESOLVED'],
      default: 'OPEN',
      index: true
    }
  },
  {
    timestamps: true
  }
);

export const IncidentLog: Model<IIncidentLog> =
  mongoose.models.IncidentLog || mongoose.model<IIncidentLog>('IncidentLog', IncidentLogSchema);
