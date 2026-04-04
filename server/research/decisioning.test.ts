import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisionFromMemo } from './decisioning.js';
import { ResearchTimeoutError } from './errors.js';
import type { VendorResolution } from './vendorIntake.js';

const resolution: VendorResolution = {
  canonicalName: 'Grammarly',
  officialDomains: ['grammarly.com', 'support.grammarly.com'],
  confidence: 'high',
  alternatives: [],
  rationale: 'Resolved to the SaaS vendor.'
};

test('buildDecisionFromMemo uses the LLM decision output and filters evidence to official domains', async () => {
  const memo = `
Vendor: Grammarly
EU data residency: Enterprise customers can select an EU data region.
Enterprise deployment: Supports SAML SSO and SCIM.
Preliminary verdict: Grammarly supports enterprise deployment and EU residency options.
`.trim();

  let seenPrompt = '';

  const decision = await buildDecisionFromMemo(
    'Grammarly',
    memo,
    resolution,
    Date.now(),
    30_000,
    async (_agent, input) => {
      seenPrompt = input;

      return {
        finalOutput: {
          companyName: ' Grammarly ',
          researchedAt: 'not-a-date',
          vendorOverview: '  Grammarly offers enterprise writing assistance.  ',
          preliminaryVerdict:
            'Grammarly supports an EU residency option and enterprise deployment controls, but exact plan scope should be confirmed.',
          recommendation: 'green',
          guardrails: {
            euDataResidency: {
              status: 'supported',
              confidence: 'high',
              summary: ' EU region selection is available for enterprise plans. ',
              risks: [' Confirm the purchased tier supports EU residency. '],
              evidence: [
                {
                  title: 'Support article',
                  url: 'https://support.grammarly.com/hc/en-us/articles/123?utm_source=test',
                  publisher: 'support.grammarly.com',
                  finding: 'EU region selection is documented.',
                  sourceType: 'primary'
                },
                {
                  title: 'Third party blog',
                  url: 'https://example.com/grammarly-eu',
                  publisher: 'example.com',
                  finding: 'Ignore this',
                  sourceType: 'secondary'
                }
              ]
            },
            enterpriseDeployment: {
              status: 'supported',
              confidence: 'medium',
              summary: 'Supports SAML SSO and SCIM provisioning.',
              risks: [],
              evidence: [
                {
                  title: 'Enterprise page',
                  url: 'https://www.grammarly.com/business/enterprise',
                  publisher: 'grammarly.com',
                  finding: 'Enterprise controls are documented.',
                  sourceType: 'primary'
                }
              ]
            }
          },
          unansweredQuestions: ['  Is BYOK plan-scoped?  ']
        }
      };
    }
  );

  assert.match(seenPrompt, /Research memo:/);
  assert.match(seenPrompt, /officialDomains/);
  assert.equal(decision.companyName, 'Grammarly');
  assert.match(decision.researchedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(decision.guardrails.euDataResidency.status, 'supported');
  assert.deepEqual(
    decision.guardrails.euDataResidency.evidence.map((item) => item.url),
    ['https://support.grammarly.com/hc/en-us/articles/123']
  );
  assert.equal(decision.guardrails.euDataResidency.evidence[0]?.title, 'Support article');
  assert.equal(
    decision.guardrails.enterpriseDeployment.risks[0],
    'Validate contract terms and implementation scope directly with the vendor.'
  );
  assert.deepEqual(decision.unansweredQuestions, ['Is BYOK plan-scoped?']);
});

test('buildDecisionFromMemo preserves model semantics for unsupported residency and partial deployment', async () => {
  const decision = await buildDecisionFromMemo(
    'TransferCo',
    'memo',
    {
      ...resolution,
      canonicalName: 'TransferCo',
      officialDomains: ['transferco.com']
    },
    Date.now(),
    30_000,
    async () => ({
      finalOutput: {
        companyName: 'TransferCo',
        researchedAt: new Date('2026-04-03T10:00:00Z').toISOString(),
        vendorOverview: 'TransferCo documents privacy controls.',
        preliminaryVerdict:
          'TransferCo does not document an EU residency option, and enterprise deployment controls appear plan-scoped.',
        recommendation: 'red',
        guardrails: {
          euDataResidency: {
            status: 'unsupported',
            confidence: 'high',
            summary:
              'The memo only documents GDPR, SCCs, and transfer mechanisms, not an EU residency option.',
            risks: ['Public evidence indicates the vendor does not meet the EU residency guardrail.'],
            evidence: []
          },
          enterpriseDeployment: {
            status: 'partial',
            confidence: 'medium',
            summary: 'Enterprise controls exist but appear limited to certain tiers.',
            risks: ['Enterprise controls appear conditional rather than universally available.'],
            evidence: []
          }
        },
        unansweredQuestions: []
      }
    })
  );

  assert.equal(decision.guardrails.euDataResidency.status, 'unsupported');
  assert.equal(decision.guardrails.enterpriseDeployment.status, 'partial');
  assert.equal(decision.recommendation, 'red');
});

test('buildDecisionFromMemo tolerates partial LLM output and defaults missing sections safely', async () => {
  const decision = await buildDecisionFromMemo(
    'Grammarly',
    'memo',
    resolution,
    Date.now(),
    30_000,
    async () => ({
      finalOutput: {
        companyName: 'Grammarly',
        researchedAt: new Date('2026-04-03T10:00:00Z').toISOString(),
        vendorOverview: 'Grammarly provides writing assistance for enterprises.',
        recommendation: 'yellow',
        guardrails: {
          euDataResidency: {
            status: 'supported',
            confidence: 'medium',
            summary: 'EU region support is documented.',
            risks: [],
            evidence: []
          }
        }
      }
    })
  );

  assert.equal(decision.guardrails.euDataResidency.status, 'supported');
  assert.equal(decision.guardrails.enterpriseDeployment.status, 'unknown');
  assert.equal(decision.guardrails.enterpriseDeployment.confidence, 'low');
  assert.match(
    decision.guardrails.enterpriseDeployment.summary,
    /did not return a complete assessment/i
  );
  assert.deepEqual(decision.unansweredQuestions, []);
  assert.match(decision.preliminaryVerdict, /EU data residency is supported/i);
});

test('buildDecisionFromMemo downgrades optimistic recommendations when normalized statuses are weaker', async () => {
  const decision = await buildDecisionFromMemo(
    'Grammarly',
    'memo',
    resolution,
    Date.now(),
    30_000,
    async () => ({
      finalOutput: {
        companyName: 'Grammarly',
        researchedAt: new Date('2026-04-03T10:00:00Z').toISOString(),
        vendorOverview: 'Grammarly provides writing assistance for enterprises.',
        preliminaryVerdict: 'Looks strong overall.',
        recommendation: 'green',
        guardrails: {
          euDataResidency: {
            status: 'supported',
            confidence: 'high',
            summary: 'EU region support is documented.',
            risks: [],
            evidence: []
          }
        }
      }
    })
  );

  assert.equal(decision.guardrails.enterpriseDeployment.status, 'unknown');
  assert.equal(decision.recommendation, 'yellow');
});

test('buildDecisionFromMemo derives product context from the memo section when vendorOverview is absent', async () => {
  const memo = `
Vendor
Miro
What this product does
Miro is a collaborative online whiteboard platform used for workshops, diagrams, and product planning across distributed teams.
EU data residency
EU data region support is documented for enterprise plans.
Enterprise deployment
SAML SSO and SCIM are documented.
Preliminary verdict
Miro shows usable enterprise controls with a documented EU data region option.
`.trim();

  const decision = await buildDecisionFromMemo(
    'Miro',
    memo,
    {
      canonicalName: 'Miro',
      officialDomains: ['miro.com'],
      confidence: 'high',
      alternatives: [],
      rationale: 'Resolved to Miro.'
    },
    Date.now(),
    30_000,
    async () => ({
      finalOutput: {
        companyName: 'Miro',
        researchedAt: new Date('2026-04-03T10:00:00Z').toISOString(),
        recommendation: 'green',
        guardrails: {
          euDataResidency: {
            status: 'supported',
            confidence: 'high',
            summary: 'EU data region support is documented.',
            risks: [],
            evidence: []
          },
          enterpriseDeployment: {
            status: 'supported',
            confidence: 'medium',
            summary: 'Enterprise controls are documented.',
            risks: [],
            evidence: []
          }
        },
        unansweredQuestions: []
      }
    })
  );

  assert.match(decision.vendorOverview, /collaborative online whiteboard platform/i);
});

test('buildDecisionFromMemo truncates oversized evidence fields instead of rejecting the decision', async () => {
  const longFinding =
    'Microsoft documents regional deployment controls for Fabric workloads and related data services, but the evidence summary returned by the model is intentionally verbose here so it exceeds the downstream presentation limit and exercises raw-schema tolerance before normalization.'.repeat(
      2
    );

  const decision = await buildDecisionFromMemo(
    'Microsoft Fabric',
    'memo',
    {
      canonicalName: 'Microsoft',
      officialDomains: ['microsoft.com', 'fabric.microsoft.com', 'learn.microsoft.com'],
      confidence: 'high',
      alternatives: [],
      rationale: 'Resolved to Microsoft.'
    },
    Date.now(),
    30_000,
    async () => ({
      finalOutput: {
        companyName: 'Microsoft Fabric',
        researchedAt: new Date('2026-04-03T10:00:00Z').toISOString(),
        vendorOverview: 'Microsoft Fabric is part of Microsoft data platform services.',
        preliminaryVerdict: 'Fabric appears to support the target enterprise guardrails.',
        recommendation: 'green',
        guardrails: {
          euDataResidency: {
            status: 'supported',
            confidence: 'high',
            summary: 'EU regional deployment is documented.',
            risks: [],
            evidence: [
              {
                title: 'Fabric regional availability',
                url: 'https://learn.microsoft.com/en-us/fabric/enterprise/regional-availability',
                publisher: 'learn.microsoft.com',
                finding: longFinding,
                sourceType: 'primary'
              }
            ]
          },
          enterpriseDeployment: {
            status: 'supported',
            confidence: 'high',
            summary: 'Enterprise deployment features are documented.',
            risks: [],
            evidence: []
          }
        },
        unansweredQuestions: []
      }
    })
  );

  assert.equal(decision.guardrails.euDataResidency.evidence.length, 1);
  assert.ok(decision.guardrails.euDataResidency.evidence[0]);
  assert.ok(decision.guardrails.euDataResidency.evidence[0]!.finding.length <= 220);
});

test('buildDecisionFromMemo preserves a product subject when the resolved owner is broader', async () => {
  const memo = `
Vendor
Microsoft
What this product does
Microsoft Fabric is a unified analytics platform that combines data engineering, data integration, real-time analytics, and business intelligence workloads.
EU data residency
Fabric supports deployment in European regions through Microsoft-managed regional services.
Enterprise deployment
Fabric integrates with enterprise identity, admin, and governance controls.
Preliminary verdict
Microsoft Fabric appears enterprise-ready with documented European region support and enterprise controls.
`.trim();

  const decision = await buildDecisionFromMemo(
    'Microsoft Fabric',
    memo,
    {
      canonicalName: 'Microsoft',
      officialDomains: ['microsoft.com', 'fabric.microsoft.com', 'learn.microsoft.com'],
      confidence: 'high',
      alternatives: [],
      rationale: 'Resolved to Microsoft.'
    },
    Date.now(),
    30_000,
    async () => ({
      finalOutput: {
        companyName: 'Microsoft',
        researchedAt: new Date('2026-04-03T10:00:00Z').toISOString(),
        vendorOverview:
          'Microsoft is an enterprise technology vendor offering cloud, productivity, and security services.',
        preliminaryVerdict:
          'Microsoft Fabric appears enterprise-ready with documented European region support and enterprise controls.',
        recommendation: 'green',
        guardrails: {
          euDataResidency: {
            status: 'supported',
            confidence: 'high',
            summary: 'European region support is documented.',
            risks: [],
            evidence: []
          },
          enterpriseDeployment: {
            status: 'supported',
            confidence: 'high',
            summary: 'Enterprise deployment controls are documented.',
            risks: [],
            evidence: []
          }
        },
        unansweredQuestions: []
      }
    })
  );

  assert.equal(decision.companyName, 'Microsoft Fabric');
  assert.match(decision.vendorOverview, /unified analytics platform/i);
});

test('buildDecisionFromMemo maps decision-stage budget exhaustion to ResearchTimeoutError', async () => {
  await assert.rejects(
    () =>
      buildDecisionFromMemo(
        'Grammarly',
        'memo',
        resolution,
        Date.now() - 29_500,
        30_000,
        async () => ({
          finalOutput: {}
        })
      ),
    (error: unknown) => error instanceof ResearchTimeoutError
  );
});
