import { z } from 'zod';

export const TriageRequestSchema = z.object({
  rawLog: z.string().min(1, 'Log content cannot be empty'),
  serviceName: z.string().trim().optional()
});

export type TriageRequest = z.infer<typeof TriageRequestSchema>;

export const IncidentStatusUpdateSchema = z.object({
  status: z.enum(['OPEN', 'TRIAGED', 'RESOLVED'], {
    errorMap: () => ({ message: 'Status must be OPEN, TRIAGED, or RESOLVED' })
  })
});

export type IncidentStatusUpdate = z.infer<typeof IncidentStatusUpdateSchema>;

export const IncidentQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  status: z.enum(['OPEN', 'TRIAGED', 'RESOLVED']).optional(),
  serviceName: z.string().trim().optional(),
  q: z.string().trim().optional(),
  includeRaw: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => val === true || val === 'true')
});

export type IncidentQuery = z.infer<typeof IncidentQuerySchema>;
