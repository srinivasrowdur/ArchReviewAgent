import { Agent, run } from '@openai/agents';
import { z } from 'zod';
import { MissingOpenAIKeyError, isAbortError } from '../../server/research/errors.js';
import { getEvalModelSetting } from '../modelConfig.js';
import type { GuardrailQualityCase } from './guardrailQualityCaseSchema.js';
import { guardrailQualityFlagSchema } from './guardrailQualityCaseSchema.js';

export type GuardrailQualityGraderInput = Pick<
  GuardrailQualityCase,
  'requestedSubject' | 'report'
>;

export const guardrailQualityGradeSchema = z.object({
  pass: z.boolean(),
  score: z.number().min(0).max(1),
  reason: z.string().min(1).max(420),
  flags: z.array(guardrailQualityFlagSchema).max(5),
  euResidencyVerdictSupport: z.enum(['strong', 'partial', 'poor']),
  enterpriseDeploymentVerdictSupport: z.enum(['strong', 'partial', 'poor']),
  recommendationQuality: z.enum(['justified', 'optimistic', 'unclear']),
  citationRelevance: z.enum(['strong', 'mixed', 'poor'])
});

export type GuardrailQualityGrade = z.infer<typeof guardrailQualityGradeSchema>;

type GraderRunFn = (
  agent: Agent<any, any>,
  input: string,
  options: { maxTurns: number; signal: AbortSignal }
) => Promise<{ finalOutput?: unknown }>;

export async function gradeGuardrailQualityCase(
  testCase: GuardrailQualityCase,
  {
    model = getEvalModelSetting().value,
    runGrader = run
  }: {
    model?: string;
    runGrader?: GraderRunFn;
  } = {}
): Promise<GuardrailQualityGrade> {
  return gradeGuardrailQualityInput(testCase, { model, runGrader });
}

export async function gradeGuardrailQualityInput(
  input: GuardrailQualityGraderInput,
  {
    model = getEvalModelSetting().value,
    runGrader = run
  }: {
    model?: string;
    runGrader?: GraderRunFn;
  } = {}
): Promise<GuardrailQualityGrade> {
  if (runGrader === run && !process.env.OPENAI_API_KEY?.trim()) {
    throw new MissingOpenAIKeyError();
  }

  const graderAgent = createGuardrailQualityGraderAgent(model);

  try {
    const result = await runGrader(
      graderAgent,
      buildGuardrailQualityPrompt(input),
      {
        maxTurns: 4,
        signal: AbortSignal.timeout(40_000)
      }
    );

    return guardrailQualityGradeSchema.parse(result.finalOutput);
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error('Guardrail quality grader timed out.');
    }

    throw error;
  }
}

function createGuardrailQualityGraderAgent(model: string) {
  return new Agent({
    name: 'Guardrail evidence quality grader',
    instructions: `
You are grading whether a generated enterprise-readiness report is actually supported by its own cited evidence.

Requirements:
- use only the structured case input
- do not browse the web
- evaluate the two guardrails independently:
  - euDataResidency
  - enterpriseDeployment
- judge whether each guardrail status and summary are supported by the cited evidence
- verdict support means support for the report's chosen verdict, not the vendor's absolute capability; a cautious partial verdict can still have strong support when the evidence clearly justifies that partial conclusion
- flag unsupported_verdict when a guardrail status or summary overstates what the evidence shows
- flag irrelevant_citations when evidence is generic, off-topic, or does not address the claimed guardrail
- flag optimistic_recommendation when the overall recommendation is more favorable than the guardrail evidence justifies
- flag thin_evidence when there is too little concrete evidence to support the stated guardrail outcome
- flag contradictory_evidence when the stated summary conflicts with the evidence findings
- use citationRelevance=strong when most citations directly address the claimed guardrail, mixed when there is a blend of direct and generic evidence, and poor when citations mostly fail to address the claim
- use recommendationQuality=optimistic when the overall recommendation is clearly too favorable
- use recommendationQuality=unclear when the evidence is too mixed or thin to justify confidence either way
- if pass is true, do not include any negative flags
- pass should be false when any major support problem is present
- score should be between 0 and 1
`.trim(),
    model,
    outputType: guardrailQualityGradeSchema,
    modelSettings: {
      toolChoice: 'auto',
      maxTokens: 400,
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

function buildGuardrailQualityPrompt(input: GuardrailQualityGraderInput) {
  return `
Grade whether this report's guardrail verdicts and overall recommendation are supported by the cited evidence.

Case input:
${JSON.stringify(
    {
      requestedSubject: input.requestedSubject,
      report: {
        companyName: input.report.companyName,
        recommendation: input.report.recommendation,
        deploymentVerdict: input.report.deploymentVerdict,
        guardrails: input.report.guardrails
      }
    },
    null,
    2
  )}
`.trim();
}
