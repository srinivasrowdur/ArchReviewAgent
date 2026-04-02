import test from 'node:test';
import assert from 'node:assert/strict';
import { presentDecision } from './presentation.js';
import type { ResearchDecision } from './decisioning.js';

const baseDecision: ResearchDecision = {
  companyName: 'Grammarly',
  researchedAt: '2026-04-02T21:50:56.881Z',
  vendorOverview: 'Grammarly is a writing assistant sold to enterprise teams.',
  preliminaryVerdict: '',
  recommendation: 'red',
  guardrails: {
    euDataResidency: {
      status: 'unsupported',
      confidence: 'high',
      summary: 'No evidence of EU-only data residency; vendor materials point to US-hosted storage.',
      risks: ['Public evidence indicates the vendor does not meet the EU residency guardrail.'],
      evidence: []
    },
    enterpriseDeployment: {
      status: 'supported',
      confidence: 'medium',
      summary: 'SAML SSO and SCIM are documented for enterprise plans.',
      risks: ['Validate contract terms and implementation scope directly with the vendor.'],
      evidence: []
    }
  },
  unansweredQuestions: []
};

test('presentDecision applies presentation fallbacks without changing the verdict', () => {
  const report = presentDecision(baseDecision);

  assert.equal(report.companyName, 'Grammarly');
  assert.equal(report.researchedAt, '2026-04-02T21:50:56.881Z');
  assert.equal(report.recommendation, 'red');
  assert.equal(report.guardrails.euDataResidency.status, 'unsupported');
  assert.match(report.executiveSummary, /shows material security-review risk/i);
  assert.equal(
    report.deploymentVerdict,
    'Security analyst verdict generated from the structured evidence review.'
  );
  assert.deepEqual(report.unansweredQuestions, [
    'No specific unanswered questions were captured in the research memo.'
  ]);
  assert.deepEqual(report.nextSteps, [
    'Escalate the guardrail gap before approving the vendor.',
    'Review the cited vendor documentation directly.',
    'Confirm data residency and deployment terms in writing with the vendor.',
    'Validate plan-specific controls such as SSO, SCIM, audit logs, and contractual commitments.'
  ]);
});

test('presentDecision preserves a substantive preliminary verdict', () => {
  const decision: ResearchDecision = {
    ...baseDecision,
    recommendation: 'yellow',
    preliminaryVerdict:
      'Grammarly presents a mixed posture because enterprise controls are documented, but EU residency remains unsupported in public vendor materials and needs procurement escalation.',
    unansweredQuestions: ['Is region pinning contractually committed for the enterprise plan?']
  };

  const report = presentDecision(decision);

  assert.equal(report.recommendation, 'yellow');
  assert.equal(report.executiveSummary, decision.preliminaryVerdict);
  assert.equal(report.deploymentVerdict, decision.preliminaryVerdict);
  assert.deepEqual(report.unansweredQuestions, [
    'Is region pinning contractually committed for the enterprise plan?'
  ]);
});
