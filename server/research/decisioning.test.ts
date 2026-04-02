import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisionFromMemo } from './decisioning.js';
import type { VendorResolution } from './vendorIntake.js';

const resolution: VendorResolution = {
  canonicalName: 'Grammarly',
  officialDomains: ['grammarly.com', 'support.grammarly.com'],
  confidence: 'high',
  alternatives: [],
  rationale: 'Resolved to the SaaS vendor.'
};

test('buildDecisionFromMemo converts a markdown memo into a structured decision', () => {
  const memo = `
**Vendor**
Grammarly is a writing assistant sold to enterprise teams.

**EU data residency**
No evidence of EU data residency. Grammarly's security page says it hosts data in AWS US East.
Sources: https://www.grammarly.com/security ; https://www.grammarly.com/privacy-policy-spring-2023?utm_source=test

**Enterprise deployment**
Yes, with meaningful enterprise controls. Grammarly documents SAML SSO, SCIM provisioning, and admin controls.
Sources: https://www.grammarly.com/business/enterprise ; https://support.grammarly.com/hc/en-us/articles/360048683092-Set-up-SAML-single-sign-on

**Preliminary verdict**
Grammarly shows material security-review risk because public evidence does not support EU data residency, even though enterprise deployment controls are documented.

**Unanswered questions**
- Is BYOK available on the plan in scope?
- Is data region pinning contractually committed?
`.trim();

  const decision = buildDecisionFromMemo('Grammarly', memo, resolution);

  assert.equal(decision.companyName, 'Grammarly');
  assert.equal(decision.guardrails.euDataResidency.status, 'unsupported');
  assert.equal(decision.guardrails.euDataResidency.confidence, 'high');
  assert.equal(decision.guardrails.enterpriseDeployment.status, 'supported');
  assert.equal(decision.recommendation, 'red');
  assert.doesNotMatch(decision.guardrails.euDataResidency.summary, /https?:\/\//);
  assert.deepEqual(
    decision.guardrails.euDataResidency.evidence.map((item) => item.url),
    [
      'https://www.grammarly.com/security',
      'https://www.grammarly.com/privacy-policy-spring-2023'
    ]
  );
  assert.deepEqual(decision.unansweredQuestions, [
    'Is BYOK available on the plan in scope?',
    'Is data region pinning contractually committed?'
  ]);
});

test('buildDecisionFromMemo classifies conditional EU residency as partial', () => {
  const memo = `
Vendor: ExampleCo
EU data residency: EU region hosting is available for some enterprise plans, but transfers outside the EU may still occur under contractual safeguards. Sources: https://www.exampleco.com/security
Enterprise deployment: Supports SAML SSO, SCIM, audit logs, and admin controls. Sources: https://www.exampleco.com/enterprise
Preliminary verdict: ExampleCo has a mixed security posture because EU residency appears conditional rather than default, even though enterprise identity and administration controls are documented in vendor materials.
`.trim();

  const decision = buildDecisionFromMemo('ExampleCo', memo, {
    ...resolution,
    canonicalName: 'ExampleCo',
    officialDomains: ['exampleco.com']
  });

  assert.equal(decision.guardrails.euDataResidency.status, 'partial');
  assert.equal(decision.guardrails.enterpriseDeployment.status, 'supported');
  assert.equal(decision.recommendation, 'yellow');
  assert.match(
    decision.guardrails.euDataResidency.risks[0] ?? '',
    /conditional|compliance-based/i
  );
});

test('buildDecisionFromMemo uses unknown only when the memo lacks decisive evidence', () => {
  const memo = `
Vendor: QuietVendor
EU data residency: Data residency is not publicly stated in current vendor materials.
Enterprise deployment: Supports SAML SSO and SCIM provisioning. Sources: https://www.quietvendor.com/security
Preliminary verdict: Security review is incomplete because residency evidence is missing from public sources.
`.trim();

  const decision = buildDecisionFromMemo('QuietVendor', memo, {
    ...resolution,
    canonicalName: 'QuietVendor',
    officialDomains: ['quietvendor.com']
  });

  assert.equal(decision.guardrails.euDataResidency.status, 'unknown');
  assert.equal(decision.guardrails.euDataResidency.confidence, 'low');
  assert.equal(decision.guardrails.enterpriseDeployment.status, 'supported');
  assert.equal(decision.recommendation, 'yellow');
  assert.deepEqual(decision.unansweredQuestions, []);
});
