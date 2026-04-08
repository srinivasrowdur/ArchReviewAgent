import { z } from 'zod';
import { evidenceItemSchema } from '../server/research/reportSchema.js';

const cacheSourceCaseBaseSchema = z.object({
  id: z
    .string()
    .trim()
    .min(3)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message: 'Case id must be kebab-case.'
    }),
  category: z.enum(['cache-promotion', 'cache-convergence', 'source-safety']),
  notes: z.string().trim().min(1)
});

const guardrailAssessmentSchema = z.object({
  status: z.enum(['supported', 'partial', 'unsupported', 'unknown']),
  confidence: z.enum(['high', 'medium', 'low']),
  evidence: z.array(evidenceItemSchema)
});

const reportLiteSchema = z.object({
  companyName: z.string().trim().min(1),
  recommendation: z.enum(['green', 'yellow', 'red']),
  guardrails: z.object({
    euDataResidency: guardrailAssessmentSchema,
    enterpriseDeployment: guardrailAssessmentSchema
  })
});

const cachePromotionCaseSchema = cacheSourceCaseBaseSchema.extend({
  category: z.literal('cache-promotion'),
  baseline: reportLiteSchema.nullable(),
  candidate: reportLiteSchema,
  expected: z.object({
    promoteCandidate: z.boolean(),
    reason: z.enum([
      'no_baseline',
      'baseline_missing',
      'candidate_unknown',
      'candidate_missing_evidence',
      'evidence_count_regressed',
      'candidate_coverage_acceptable'
    ]),
    detail: z.string().optional()
  })
});

const cacheConvergenceCaseSchema = cacheSourceCaseBaseSchema.extend({
  category: z.literal('cache-convergence'),
  requestedSubjectName: z.string().min(1),
  canonicalName: z.string().min(1),
  rows: z
    .array(
      z.object({
        requested_subject_name: z.string().min(1),
        canonical_name: z.string().min(1),
        official_domains: z.array(z.string().min(1)).min(1),
        confidence: z.enum(['high', 'medium', 'low']),
        alternatives: z.array(z.string()),
        rationale: z.string()
      })
    )
    .min(1),
  expected: z.object({
    cacheKeys: z.array(z.string().min(1)).min(1),
    winningDomains: z.array(z.string().min(1)).min(1)
  })
});

const sourceSafetyCaseSchema = cacheSourceCaseBaseSchema.extend({
  category: z.literal('source-safety'),
  url: z.string().min(1),
  allowedDomains: z.array(z.string().min(1)).min(1),
  expected: z.object({
    normalizedUrl: z.string(),
    allowed: z.boolean()
  })
});

export const cacheSourceCaseSchema = z.discriminatedUnion('category', [
  cachePromotionCaseSchema,
  cacheConvergenceCaseSchema,
  sourceSafetyCaseSchema
]);

export type CacheSourceCase = z.infer<typeof cacheSourceCaseSchema>;
