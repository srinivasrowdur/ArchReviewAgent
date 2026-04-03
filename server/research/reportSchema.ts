import { z } from 'zod';

export const evidenceItemSchema = z.object({
  title: z.string().min(1).max(160),
  url: z.string().min(1).max(400),
  publisher: z.string().min(1).max(120),
  finding: z.string().min(1).max(220),
  sourceType: z.enum(['primary', 'secondary'])
});

export const assessmentSchema = z.object({
  status: z.enum(['supported', 'partial', 'unsupported', 'unknown']),
  confidence: z.enum(['high', 'medium', 'low']),
  summary: z.string().min(1).max(420),
  risks: z.array(z.string().min(1).max(220)).max(5),
  evidence: z.array(evidenceItemSchema).max(5)
});

export const guardrailsSchema = z.object({
  euDataResidency: assessmentSchema,
  enterpriseDeployment: assessmentSchema
});

export function normalizeIsoDate(value: string | undefined) {
  if (!value?.trim()) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}
