import { z } from 'zod';

const publicSurfaceRequestSchema = z.object({
  method: z.enum(['GET', 'POST', 'OPTIONS']),
  path: z.string().startsWith('/'),
  headers: z.record(z.string()).optional().default({}),
  body: z.unknown().optional()
});

const publicSurfaceExpectationSchema = z.object({
  status: z.number().int().min(100).max(599),
  requiredHeaders: z.record(z.string()).optional().default({}),
  headerContains: z.record(z.array(z.string().min(1)).min(1)).optional().default({}),
  absentHeaders: z.array(z.string().min(1)).optional().default([]),
  jsonBody: z.unknown().optional()
});

export const publicSurfaceCaseSchema = z.object({
  id: z
    .string()
    .trim()
    .min(3)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message: 'Case id must be kebab-case.'
    }),
  category: z.enum(['cors', 'security-headers', 'endpoint-exposure']),
  notes: z.string().trim().min(1),
  request: publicSurfaceRequestSchema,
  expected: publicSurfaceExpectationSchema
});

export type PublicSurfaceCase = z.infer<typeof publicSurfaceCaseSchema>;
