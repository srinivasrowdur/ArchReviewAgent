import { z } from 'zod';

const allowedStatusSchema = z.enum([
  'supported',
  'partial',
  'unsupported',
  'unknown'
]);

const allowedRecommendationSchema = z.enum(['green', 'yellow', 'red']);

const expectedGuardrailSchema = z.object({
  status: allowedStatusSchema,
  allow_equivalents: z.array(allowedStatusSchema).optional().default([])
});

export const evalCaseSchema = z.object({
  id: z
    .string()
    .trim()
    .min(3)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message: 'Case id must be kebab-case.'
    }),
  category: z.string().trim().min(1),
  input: z.string().trim().min(2),
  expected_subject: z.string().trim().min(1),
  expected_vendor: z.string().trim().min(1),
  expected_official_domains: z.array(z.string().trim().min(1)).min(1),
  expected_guardrails: z.object({
    euDataResidency: expectedGuardrailSchema,
    enterpriseDeployment: expectedGuardrailSchema
  }),
  expected_recommendation: allowedRecommendationSchema,
  allowed_unknowns: z.array(z.enum(['euDataResidency', 'enterpriseDeployment'])),
  notes: z.string().trim().min(1)
});

export type EvalCase = z.infer<typeof evalCaseSchema>;
