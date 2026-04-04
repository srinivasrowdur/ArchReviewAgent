import type { EnterpriseReadinessReport } from '../shared/contracts.js';

export function createMockReport(companyName: string): EnterpriseReadinessReport {
  const normalizedCompanyName = companyName.trim() || 'Sample Vendor';
  const slug = normalizedCompanyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const baseUrl = `https://example.com/vendors/${slug || 'sample-vendor'}`;

  return {
    companyName: normalizedCompanyName,
    researchedAt: new Date().toISOString(),
    overview:
      `${normalizedCompanyName} is represented here as a software product used by enterprise teams. This mocked section stands in for the live "What this product does" summary that would normally be grounded in vendor-controlled product pages.`,
    executiveSummary:
      `${normalizedCompanyName} is shown here as a yellow security-review candidate in test mode. The sample report simulates partial EU residency support and usable enterprise controls so you can validate the UI and API behavior before using the live research path.`,
    recommendation: 'yellow',
    deploymentVerdict:
      'Mock verdict: suitable for UI testing, but the live path should still be used before any real security conclusion.',
    guardrails: {
      euDataResidency: {
        status: 'partial',
        confidence: 'medium',
        summary:
          'Sample output indicates the vendor advertises EU hosting, but region-locking terms remain unclear in the mocked evidence set.',
        risks: [
          'Customer-controlled region pinning is not explicitly confirmed.',
          'Contractual language for EU-only processing remains unverified in this sample.'
        ],
        evidence: [
          {
            title: 'Sample residency page',
            url: `${baseUrl}/eu-residency`,
            publisher: normalizedCompanyName,
            finding: 'States EU data hosting is available for enterprise customers.',
            sourceType: 'primary'
          },
          {
            title: 'Sample trust center',
            url: `${baseUrl}/trust`,
            publisher: normalizedCompanyName,
            finding: 'References GDPR alignment but does not fully clarify region enforcement.',
            sourceType: 'primary'
          }
        ]
      },
      enterpriseDeployment: {
        status: 'supported',
        confidence: 'high',
        summary:
          'Mock enterprise posture includes SSO, SCIM, audit logs, and an enterprise sales motion suitable for testing the happy path.',
        risks: [
          'Dedicated single-tenant deployment is not represented in the sample.',
          'Private-cloud language should be verified in a live run.'
        ],
        evidence: [
          {
            title: 'Sample enterprise plan',
            url: `${baseUrl}/enterprise`,
            publisher: normalizedCompanyName,
            finding: 'Lists SSO, SCIM, admin controls, and audit logs.',
            sourceType: 'primary'
          }
        ]
      }
    },
    unansweredQuestions: [
      'Does the live vendor contract guarantee EU-only storage and processing?',
      'Is private or dedicated deployment available beyond the standard enterprise plan?'
    ],
    nextSteps: [
      'Run a live research check for the real vendor evidence.',
      'Confirm data residency terms in the vendor DPA.',
      'Validate deployment options with sales or solution engineering.'
    ]
  };
}
