import { z } from 'zod';

const guardrailKeySchema = z.enum(['euDataResidency', 'enterpriseDeployment']);
const allowedStatusSchema = z.enum([
  'supported',
  'partial',
  'unsupported',
  'unknown'
]);
const allowedRecommendationSchema = z.enum(['green', 'yellow', 'red']);

const baseEvalCaseSchema = z.object({
  id: z
    .string()
    .trim()
    .min(3)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message: 'Case id must be kebab-case.'
    }),
  category: z.string().trim().min(1),
  input: z.string().min(1),
  notes: z.string().trim().min(1)
});

const expectedGuardrailSchema = z.object({
  status: allowedStatusSchema,
  allow_equivalents: z.array(allowedStatusSchema).optional().default([])
});

const successEvalCaseSchema = baseEvalCaseSchema.extend({
  expected_outcome: z.literal('success'),
  expected_subject: z.string().trim().min(1),
  expected_vendor: z.string().trim().min(1),
  expected_official_domains: z.array(z.string().trim().min(1)).min(1),
  expected_guardrails: z.object({
    euDataResidency: expectedGuardrailSchema,
    enterpriseDeployment: expectedGuardrailSchema
  }),
  expected_recommendation: allowedRecommendationSchema,
  allowed_unknowns: z.array(guardrailKeySchema)
});

const rejectionEvalCaseSchema = baseEvalCaseSchema.extend({
  expected_outcome: z.literal('rejection'),
  expected_error: z.object({
    status: z.number().int().min(400).max(499),
    message_includes: z.string().trim().min(1)
  })
});

export const evalCaseSchema = z.discriminatedUnion('expected_outcome', [
  successEvalCaseSchema,
  rejectionEvalCaseSchema
]);

export type EvalCase = z.infer<typeof evalCaseSchema>;
export type EvalSuccessCase = z.infer<typeof successEvalCaseSchema>;
export type EvalRejectionCase = z.infer<typeof rejectionEvalCaseSchema>;
