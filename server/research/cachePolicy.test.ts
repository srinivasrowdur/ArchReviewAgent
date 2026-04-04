import test from 'node:test';
import assert from 'node:assert/strict';
import type { EnterpriseReadinessReport } from '../../shared/contracts.js';
import { evaluateCandidateReport } from './cachePolicy.js';

function createReport(
  overrides: Partial<EnterpriseReadinessReport> = {}
): EnterpriseReadinessReport {
  const base: EnterpriseReadinessReport = {
    companyName: 'Vendor',
    researchedAt: '2026-04-04T09:00:00.000Z',
    overview: 'Overview',
    executiveSummary: 'Executive summary with enough length to satisfy presentation rules.',
    recommendation: 'yellow',
    deploymentVerdict: 'Verdict',
    guardrails: {
      euDataResidency: {
        status: 'supported',
        confidence: 'high',
        summary: 'EU supported',
        risks: [],
        evidence: [
          {
            title: 'EU source',
            url: 'https://vendor.example/eu',
            publisher: 'vendor.example',
            finding: 'EU region is documented.',
            sourceType: 'primary'
          }
        ]
      },
      enterpriseDeployment: {
        status: 'supported',
        confidence: 'high',
        summary: 'Enterprise supported',
        risks: [],
        evidence: [
          {
            title: 'Deployment source',
            url: 'https://vendor.example/deploy',
            publisher: 'vendor.example',
            finding: 'Enterprise controls are documented.',
            sourceType: 'primary'
          }
        ]
      }
    },
    unansweredQuestions: [],
    nextSteps: []
  };

  return {
    ...base,
    ...overrides,
    guardrails: {
      ...base.guardrails,
      ...overrides.guardrails
    }
  };
}

test('evaluateCandidateReport promotes a candidate when no baseline exists', () => {
  const decision = evaluateCandidateReport(createReport(), null);

  assert.equal(decision.promoteCandidate, true);
  assert.equal(decision.reason, 'no_baseline');
});

test('evaluateCandidateReport blocks promotion when candidate degrades to unknown', () => {
  const baseline = createReport();
  const candidate = createReport({
    guardrails: {
      ...baseline.guardrails,
      euDataResidency: {
        ...baseline.guardrails.euDataResidency,
        status: 'unknown'
      }
    }
  });

  const decision = evaluateCandidateReport(candidate, baseline);

  assert.equal(decision.promoteCandidate, false);
  assert.equal(decision.reason, 'candidate_unknown');
  assert.equal(decision.detail, 'euDataResidency');
});

test('evaluateCandidateReport blocks promotion when a guardrail has no evidence', () => {
  const baseline = createReport();
  const candidate = createReport({
    guardrails: {
      ...baseline.guardrails,
      enterpriseDeployment: {
        ...baseline.guardrails.enterpriseDeployment,
        evidence: []
      }
    }
  });

  const decision = evaluateCandidateReport(candidate, null);

  assert.equal(decision.promoteCandidate, false);
  assert.equal(decision.reason, 'candidate_missing_evidence');
  assert.equal(decision.detail, 'enterpriseDeployment');
});

test('evaluateCandidateReport blocks promotion when evidence count regresses', () => {
  const baseline = createReport();
  baseline.guardrails.euDataResidency.evidence.push({
    title: 'Extra source',
    url: 'https://vendor.example/eu-2',
    publisher: 'vendor.example',
    finding: 'Secondary EU page.',
    sourceType: 'primary'
  });

  const candidate = createReport();
  const decision = evaluateCandidateReport(candidate, baseline);

  assert.equal(decision.promoteCandidate, false);
  assert.equal(decision.reason, 'evidence_count_regressed');
  assert.equal(decision.detail, 'euDataResidency');
});

test('evaluateCandidateReport still promotes a candidate when source URLs rotate but coverage holds', () => {
  const baseline = createReport();
  const candidate = createReport({
    guardrails: {
      euDataResidency: {
        ...baseline.guardrails.euDataResidency,
        evidence: [
          {
            title: 'Different source',
            url: 'https://vendor.example/new-eu',
            publisher: 'vendor.example',
            finding: 'Different EU page.',
            sourceType: 'primary'
          }
        ]
      },
      enterpriseDeployment: baseline.guardrails.enterpriseDeployment
    }
  });

  const decision = evaluateCandidateReport(candidate, baseline);

  assert.equal(decision.promoteCandidate, true);
  assert.equal(decision.reason, 'candidate_coverage_acceptable');
});

test('evaluateCandidateReport promotes a candidate when coverage is same or better with overlap', () => {
  const baseline = createReport();
  const candidate = createReport();
  candidate.guardrails.euDataResidency.evidence.push({
    title: 'Extra EU source',
    url: 'https://vendor.example/eu-extra',
    publisher: 'vendor.example',
    finding: 'More EU evidence.',
    sourceType: 'primary'
  });

  const decision = evaluateCandidateReport(candidate, baseline);

  assert.equal(decision.promoteCandidate, true);
  assert.equal(decision.reason, 'candidate_coverage_acceptable');
});
