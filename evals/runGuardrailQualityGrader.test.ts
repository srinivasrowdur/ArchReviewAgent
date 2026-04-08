import assert from 'node:assert/strict';
import test from 'node:test';
import { gradeGuardrailQualityCase } from './graders/guardrailQualityGrader.js';
import {
  loadGuardrailQualityCases,
  runGuardrailQualityGrader
} from './runGuardrailQualityGrader.js';
import type { GuardrailQualityCase } from './graders/guardrailQualityCaseSchema.js';
import type { GuardrailQualityGrade } from './graders/guardrailQualityGrader.js';

test('guardrail quality grader runner passes on the seeded dataset with matching grader outputs', async () => {
  const cases = await loadGuardrailQualityCases([
    'evals/cases/guardrail-quality-grader.jsonl'
  ]);
  const summary = await runGuardrailQualityGrader(cases, async (testCase) =>
    createExpectedGrade(testCase)
  );

  assert.equal(summary.totals.failed, 0);
  assert.equal(summary.totals.passed, summary.totals.cases);
  assert.equal(summary.modelSetting.value.length > 0, true);
});

test('guardrail quality grader runner reports targeted expectation mismatches', async () => {
  const [fabricCase] = await loadGuardrailQualityCases([
    'evals/cases/guardrail-quality-grader.jsonl'
  ]);

  const summary = await runGuardrailQualityGrader([fabricCase], async () => ({
    pass: false,
    score: 0.2,
    reason: 'Intentional mismatch for test coverage.',
    flags: ['unsupported_verdict', 'irrelevant_citations', 'optimistic_recommendation'],
    euResidencyVerdictSupport: 'poor',
    enterpriseDeploymentVerdictSupport: 'partial',
    recommendationQuality: 'optimistic',
    citationRelevance: 'poor'
  }));

  assert.equal(summary.totals.failed, 1);
  assert.equal(summary.results[0]?.caseId, fabricCase.id);
  assert.match(summary.results[0]?.detail ?? '', /expected pass=true/);
  assert.match(
    summary.results[0]?.detail ?? '',
    /unexpected flag unsupported_verdict/
  );
});

test('guardrail quality grader allows injected runners without OPENAI_API_KEY', async () => {
  const [fabricCase] = await loadGuardrailQualityCases([
    'evals/cases/guardrail-quality-grader.jsonl'
  ]);
  const previousApiKey = process.env.OPENAI_API_KEY;

  delete process.env.OPENAI_API_KEY;

  try {
    const grade = await gradeGuardrailQualityCase(fabricCase, {
      runGrader: async () => ({
        finalOutput: createExpectedGrade(fabricCase)
      })
    });

    assert.equal(grade.pass, true);
    assert.deepEqual(grade.flags, fabricCase.expected.requiredFlags);
  } finally {
    if (typeof previousApiKey === 'string') {
      process.env.OPENAI_API_KEY = previousApiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  }
});

function createExpectedGrade(testCase: GuardrailQualityCase): GuardrailQualityGrade {
  const pass = testCase.expected.pass;
  const score =
    testCase.expected.minimumScore ??
    testCase.expected.maximumScore ??
    (pass ? 0.85 : 0.25);

  return {
    pass,
    score,
    reason: pass
      ? 'The report verdicts and recommendation are supported by the cited evidence.'
      : 'The report overstates what the cited evidence supports.',
    flags: testCase.expected.requiredFlags,
    euResidencyVerdictSupport: firstExpectedValue(
      testCase.expected.expectedEuResidencySupport
    ),
    enterpriseDeploymentVerdictSupport:
      firstExpectedValue(testCase.expected.expectedEnterpriseDeploymentSupport),
    recommendationQuality: firstExpectedValue(
      testCase.expected.expectedRecommendationQuality
    ),
    citationRelevance: firstExpectedValue(
      testCase.expected.expectedCitationRelevance
    )
  };
}

function firstExpectedValue(value: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}
