export interface CitationDTO {
  ref: number;
  chunkId: string;
  runbookId: string;
  fileName: string;
  headerContext: string;
  anchor: string;
  snippet: string;
  cosineSimilarity: number;
  fusedScore: number;
  retrievalSources?: Array<'keyword' | 'vector'>;
}

export interface ConfidenceBreakdownDTO {
  score: number;
  top1: number;
  margin: number;
  coverage: number;
}

export interface RepeatIncidentInfoDTO {
  priorCount: number;
  lastSeenAt?: string;
  lastIncidentId?: string;
}

export interface MitigationStepDTO {
  step: string;
  refs: number[];
  unverified?: boolean;
}

export interface PostmortemReportDTO {
  id: string;
  incidentId: string;
  summary: string;
  probableRootCause: string;
  immediateMitigation: MitigationStepDTO[];
  longTermFixes: MitigationStepDTO[];
  hypotheses: string[];
  confidence: number;
  confidenceBreakdown?: ConfidenceBreakdownDTO;
  insufficientContext: boolean;
  citations: CitationDTO[];
  llmProvider: string;
  llmModel: string;
  latencyMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentLogDTO {
  id: string;
  serviceName: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'OPEN' | 'TRIAGED' | 'RESOLVED';
  errorSignature: string;
  signatureHash: string;
  redactionCount: number;
  rawLog?: string;
  sanitizedLog: string;
  createdAt: string;
  updatedAt: string;
}

export interface TriageResponseDTO {
  incident: IncidentLogDTO;
  report: PostmortemReportDTO;
  repeatInfo: RepeatIncidentInfoDTO;
}

export interface RunbookDTO {
  id: string;
  serviceName: string;
  fileName: string;
  tags: string[];
  totalChunks: number;
  embeddingModel: string;
  embeddingDim: number;
  createdAt: string;
  updatedAt: string;
}
