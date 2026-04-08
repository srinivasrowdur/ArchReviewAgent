import { z } from 'zod';
import { enterpriseReadinessReportSchema } from '../../server/research/reportSchema.js';

export const guardrailQualityFlagSchema = z.enum([
  'unsupported_verdict',
  'irrelevant_citations',
  'optimistic_recommendation',
  'thin_evidence',
  'contradictory_evidence'
]);

const verdictSupportSchema = z.enum(['strong', 'partial', 'poor']);
const recommendationQualitySchema = z.enum(['justified', 'optimistic', 'unclear']);
const citationRelevanceSchema = z.enum(['strong', 'mixed', 'poor']);
const allowedValueSchema = <T extends z.ZodTypeAny>(schema: T) =>
  z.union([schema, z.array(schema).min(1)]);

export const guardrailQualityCaseSchema = z.object({
  grader: z.literal('guardrail-quality'),
  id: z
    .string()
    .trim()
    .min(3)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message: 'Case id must be kebab-case.'
    }),
  category: z.enum([
    'well-supported',
    'unsupported-verdict',
    'irrelevant-citations',
    'optimistic-recommendation',
    'mixed-quality'
  ]),
  notes: z.string().trim().min(1),
  requestedSubject: z.string().trim().min(1).max(160),
  report: enterpriseReadinessReportSchema,
  expected: z.object({
    pass: z.boolean(),
    requiredFlags: z.array(guardrailQualityFlagSchema).default([]),
    forbiddenFlags: z.array(guardrailQualityFlagSchema).default([]),
    expectedEuResidencySupport: allowedValueSchema(verdictSupportSchema),
    expectedEnterpriseDeploymentSupport: allowedValueSchema(verdictSupportSchema),
    expectedRecommendationQuality: allowedValueSchema(recommendationQualitySchema),
    expectedCitationRelevance: allowedValueSchema(citationRelevanceSchema),
    minimumScore: z.number().min(0).max(1).optional(),
    maximumScore: z.number().min(0).max(1).optional()
  })
});

export type GuardrailQualityCase = z.infer<typeof guardrailQualityCaseSchema>;
