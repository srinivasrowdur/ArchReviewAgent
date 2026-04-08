import { z } from 'zod';
import { enterpriseReadinessReportSchema } from '../../server/research/reportSchema.js';

export const productResolutionFlagSchema = z.enum([
  'product_drift',
  'generic_overview',
  'wrong_subject_name',
  'unclear_subject_resolution',
  'weak_official_domains'
]);

export const productResolutionGraderCaseSchema = z.object({
  grader: z.literal('product-resolution'),
  id: z
    .string()
    .trim()
    .min(3)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message: 'Case id must be kebab-case.'
    }),
  category: z.enum(['product-vs-parent', 'overview-specificity', 'same-brand-subject']),
  notes: z.string().trim().min(1),
  requestedSubject: z.string().trim().min(1).max(160),
  resolvedVendor: z.object({
    canonicalName: z.string().trim().min(1).max(160),
    officialDomains: z.array(z.string().trim().min(1).max(160)).min(1).max(6)
  }),
  report: enterpriseReadinessReportSchema,
  expected: z.object({
    pass: z.boolean(),
    requiredFlags: z.array(productResolutionFlagSchema).default([]),
    forbiddenFlags: z.array(productResolutionFlagSchema).default([]),
    minimumScore: z.number().min(0).max(1).optional(),
    maximumScore: z.number().min(0).max(1).optional()
  })
});

export type ProductResolutionGraderCase = z.infer<
  typeof productResolutionGraderCaseSchema
>;
