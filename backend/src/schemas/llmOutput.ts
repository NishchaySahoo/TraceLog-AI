import { z } from 'zod';

export const MitigationItemSchema = z.object({
  step: z.string().min(1, 'Mitigation step text cannot be empty'),
  refs: z.array(z.number().int().nonnegative()).default([])
});

export type MitigationItem = z.infer<typeof MitigationItemSchema>;

export const LLMDiagnosisSchema = z.object({
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  summary: z.string().min(1, 'Summary cannot be empty'),
  probableRootCause: z.string().min(1, 'Probable root cause cannot be empty'),
  immediateMitigation: z.array(MitigationItemSchema).min(1, 'At least one immediate mitigation step required'),
  longTermFixes: z.array(MitigationItemSchema).default([]),
  hypotheses: z.array(z.string()).default([]),
  usedRefs: z.array(z.number().int().nonnegative()).default([])
});

export type LLMDiagnosis = z.infer<typeof LLMDiagnosisSchema>;
