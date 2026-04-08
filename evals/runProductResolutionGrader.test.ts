import assert from 'node:assert/strict';
import test from 'node:test';
import { gradeProductResolutionCase } from './graders/productResolutionGrader.js';
import {
  loadProductResolutionCases,
  runProductResolutionGrader
} from './runProductResolutionGrader.js';
import type { ProductResolutionGraderCase } from './graders/productResolutionCaseSchema.js';
import type { ProductResolutionGrade } from './graders/productResolutionGrader.js';

test('product resolution grader runner passes on the seeded dataset with matching grader outputs', async () => {
  const cases = await loadProductResolutionCases([
    'evals/cases/product-resolution-grader.jsonl'
  ]);
  const summary = await runProductResolutionGrader(cases, async (testCase) =>
    createExpectedGrade(testCase)
  );

  assert.equal(summary.totals.failed, 0);
  assert.equal(summary.totals.passed, summary.totals.cases);
  assert.equal(summary.modelSetting.value.length > 0, true);
});

test('product resolution grader runner reports targeted expectation mismatches', async () => {
  const [fabricCase] = await loadProductResolutionCases([
    'evals/cases/product-resolution-grader.jsonl'
  ]);

  const summary = await runProductResolutionGrader([fabricCase], async () => ({
    pass: false,
    score: 0.2,
    reason: 'Intentional mismatch for test coverage.',
    flags: ['product_drift', 'generic_overview', 'wrong_subject_name'],
    subjectAnchoring: 'parent-company',
    subjectResolutionQuality: 'poor',
    overviewSpecificity: 'generic'
  }));

  assert.equal(summary.totals.failed, 1);
  assert.equal(summary.results[0]?.caseId, fabricCase.id);
  assert.match(summary.results[0]?.detail ?? '', /expected pass=true/);
  assert.match(summary.results[0]?.detail ?? '', /unexpected flag product_drift/);
});

test('product resolution grader allows injected runners without OPENAI_API_KEY', async () => {
  const [fabricCase] = await loadProductResolutionCases([
    'evals/cases/product-resolution-grader.jsonl'
  ]);
  const previousApiKey = process.env.OPENAI_API_KEY;

  delete process.env.OPENAI_API_KEY;

  try {
    const grade = await gradeProductResolutionCase(fabricCase, {
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

function createExpectedGrade(
  testCase: ProductResolutionGraderCase
): ProductResolutionGrade {
  const pass = testCase.expected.pass;
  const score =
    testCase.expected.minimumScore ??
    testCase.expected.maximumScore ??
    (pass ? 0.85 : 0.2);

  return {
    pass,
    score,
    reason: pass
      ? 'The report stays anchored to the requested product and the overview is specific.'
      : 'The report drifts away from the requested product or uses a generic overview.',
    flags: testCase.expected.requiredFlags,
    subjectAnchoring: pass
      ? testCase.category === 'same-brand-subject'
        ? 'same-brand'
        : 'product'
      : testCase.expected.requiredFlags.includes('product_drift')
        ? 'parent-company'
        : 'product',
    subjectResolutionQuality: pass ? 'strong' : 'poor',
    overviewSpecificity: testCase.expected.requiredFlags.includes('generic_overview')
      ? 'generic'
      : 'specific'
  };
}
