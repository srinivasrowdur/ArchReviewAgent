import { Agent, run } from '@openai/agents';
import { z } from 'zod';
import { MissingOpenAIKeyError, isAbortError } from '../../server/research/errors.js';
import { getEvalModelSetting } from '../modelConfig.js';
import type { ProductResolutionGraderCase } from './productResolutionCaseSchema.js';
import { productResolutionFlagSchema } from './productResolutionCaseSchema.js';

export const productResolutionGradeSchema = z.object({
  pass: z.boolean(),
  score: z.number().min(0).max(1),
  reason: z.string().min(1).max(420),
  flags: z.array(productResolutionFlagSchema).max(5),
  subjectAnchoring: z.enum(['product', 'same-brand', 'parent-company', 'unclear']),
  subjectResolutionQuality: z.enum(['strong', 'partial', 'poor']),
  overviewSpecificity: z.enum(['specific', 'mixed', 'generic'])
});

export type ProductResolutionGrade = z.infer<typeof productResolutionGradeSchema>;

type GraderRunFn = (
  agent: Agent<any, any>,
  input: string,
  options: { maxTurns: number; signal: AbortSignal }
) => Promise<{ finalOutput?: unknown }>;

export async function gradeProductResolutionCase(
  testCase: ProductResolutionGraderCase,
  {
    model = getEvalModelSetting().value,
    runGrader = run
  }: {
    model?: string;
    runGrader?: GraderRunFn;
  } = {}
): Promise<ProductResolutionGrade> {
  if (runGrader === run && !process.env.OPENAI_API_KEY?.trim()) {
    throw new MissingOpenAIKeyError();
  }

  const graderAgent = createProductResolutionGraderAgent(model);

  try {
    const result = await runGrader(
      graderAgent,
      buildProductResolutionPrompt(testCase),
      {
        maxTurns: 4,
        signal: AbortSignal.timeout(25_000)
      }
    );

    return productResolutionGradeSchema.parse(result.finalOutput);
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error('Product resolution grader timed out.');
    }

    throw error;
  }
}

function createProductResolutionGraderAgent(model: string) {
  return new Agent({
    name: 'Product resolution quality grader',
    instructions: `
You are grading whether a generated enterprise-readiness report stayed anchored to the requested product or drifted into a broader parent company summary.

Requirements:
- use only the structured case input
- do not browse the web
- judge whether the report companyName, overview, and summary remain about the requested subject
- if the requested subject is a named product under a broader company, penalize collapsing it to the parent company
- if the requested subject and vendor are the same public-facing brand (for example Notion or Miro), matching that brand is acceptable
- flag generic company-level overview text when it does not clearly describe what the requested product does
- flag wrong_subject_name when the report title/companyName is a different broader entity than the requested subject
- flag product_drift when the report is clearly about the parent company rather than the requested product
- flag generic_overview when the overview is vague or corporate rather than product-specific
- flag unclear_subject_resolution when the report is too ambiguous to tell whether it stayed anchored
- use weak_official_domains only when the supplied official domain set is obviously too weak for the requested product
- pass should be false when any major problem is present
- score should be between 0 and 1
`.trim(),
    model,
    outputType: productResolutionGradeSchema,
    modelSettings: {
      toolChoice: 'auto',
      maxTokens: 500,
      reasoning: {
        effort: 'low',
        summary: 'auto'
      },
      text: {
        verbosity: 'low'
      }
    },
    tools: []
  });
}

function buildProductResolutionPrompt(testCase: ProductResolutionGraderCase) {
  return `
Grade whether this report stayed anchored to the requested product and whether the product overview is specific enough for an analyst.

Case input:
${JSON.stringify(
    {
      requestedSubject: testCase.requestedSubject,
      resolvedVendor: testCase.resolvedVendor,
      report: {
        companyName: testCase.report.companyName,
        overview: testCase.report.overview,
        executiveSummary: testCase.report.executiveSummary,
        deploymentVerdict: testCase.report.deploymentVerdict,
        evidence: {
          euDataResidency: testCase.report.guardrails.euDataResidency.evidence,
          enterpriseDeployment:
            testCase.report.guardrails.enterpriseDeployment.evidence
        }
      }
    },
    null,
    2
  )}
`.trim();
}
