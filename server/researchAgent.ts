import { z } from 'zod';
import type { VendorResolution } from './research/vendorIntake.js';
import {
  normalizeHostname,
  resolveVendorIdentity,
  validateVendorInput
} from './research/vendorIntake.js';
import {
  IncompleteResearchError,
  InvalidVendorInputError,
  MissingOpenAIKeyError,
  ResearchGenerationError,
  ResearchTimeoutError,
  VendorResolutionError
} from './research/errors.js';
import { generateResearchMemo } from './research/retrieval.js';
import {
  type EnterpriseReadinessReport,
  type ResearchProgressUpdate
} from '../shared/contracts.js';

const evidenceItemSchema = z.object({
  title: z.string(),
  url: z.string(),
  publisher: z.string(),
  finding: z.string(),
  sourceType: z.enum(['primary', 'secondary'])
});

const assessmentSchema = z.object({
  status: z.enum(['supported', 'partial', 'unsupported', 'unknown']),
  confidence: z.enum(['high', 'medium', 'low']),
  summary: z.string(),
  risks: z.array(z.string()).max(5),
  evidence: z.array(evidenceItemSchema).max(5)
});

const enterpriseReadinessSchema = z.object({
  companyName: z.string(),
  researchedAt: z.string(),
  overview: z.string(),
  executiveSummary: z.string(),
  recommendation: z.enum(['green', 'yellow', 'red']),
  deploymentVerdict: z.string(),
  guardrails: z.object({
    euDataResidency: assessmentSchema,
    enterpriseDeployment: assessmentSchema
  }),
  unansweredQuestions: z.array(z.string()).max(6),
  nextSteps: z.array(z.string()).max(6)
});

type StructuredReadinessReport = z.infer<typeof enterpriseReadinessSchema>;
type GuardrailKey = keyof StructuredReadinessReport['guardrails'];
type ResearchProgressListener = (update: ResearchProgressUpdate) => void;

function getResearchTimeoutMs() {
  const parsed = Number(process.env.RESEARCH_TIMEOUT_MS ?? 90_000);

  if (!Number.isFinite(parsed) || parsed < 15_000) {
    return 90_000;
  }

  return parsed;
}

export async function researchCompany(companyName: string) {
  return runResearchWorkflow(companyName);
}

export async function researchCompanyStream(
  companyName: string,
  onProgress?: ResearchProgressListener
) {
  if (!process.env.OPENAI_API_KEY) {
    throw new MissingOpenAIKeyError();
  }

  return runResearchWorkflow(companyName, onProgress);
}

async function runResearchWorkflow(
  rawCompanyName: string,
  onProgress?: ResearchProgressListener
) {
  if (!process.env.OPENAI_API_KEY) {
    throw new MissingOpenAIKeyError();
  }

  const companyName = validateVendorInput(rawCompanyName);
  const startedAt = Date.now();
  const budgetMs = getResearchTimeoutMs();
  const resolution = await resolveVendorIdentity(companyName, startedAt, budgetMs);
  const memo = await generateResearchMemo(resolution, startedAt, budgetMs, onProgress);
  const parsedReport = buildReportFromMemo(resolution.canonicalName, memo, resolution);
  validateCoverage(parsedReport);

  return normalizeReport(parsedReport, resolution.canonicalName);
}

function normalizeReport(
  report: StructuredReadinessReport,
  fallbackCompanyName: string
): EnterpriseReadinessReport {
  return {
    ...report,
    companyName: report.companyName.trim() || fallbackCompanyName,
    researchedAt: normalizeIsoDate(report.researchedAt),
    overview: report.overview.trim(),
    executiveSummary: report.executiveSummary.trim(),
    deploymentVerdict: report.deploymentVerdict.trim(),
    unansweredQuestions: report.unansweredQuestions.filter(Boolean),
    nextSteps: report.nextSteps.filter(Boolean)
  };
}

function normalizeIsoDate(value: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function validateCoverage(report: StructuredReadinessReport) {
  const hasExecutiveSummary = report.executiveSummary.trim().length > 80;
  const hasEuSummary = report.guardrails.euDataResidency.summary.trim().length > 0;
  const hasDeploymentSummary =
    report.guardrails.enterpriseDeployment.summary.trim().length > 0;

  if (!hasExecutiveSummary || !hasEuSummary || !hasDeploymentSummary) {
    throw new IncompleteResearchError();
  }
}

function buildReportFromMemo(
  companyName: string,
  memo: string,
  resolution: VendorResolution
): StructuredReadinessReport {
  const sections = parseMemoSections(memo);
  const vendorSummary = sections.vendor || memo;
  const euDataResidency = buildAssessment(
    sections.euDataResidency || inferSectionFromMemo(memo, ['residency', 'region', 'eu']),
    'euDataResidency',
    resolution
  );
  const enterpriseDeployment = buildAssessment(
    sections.enterpriseDeployment ||
      inferSectionFromMemo(memo, ['enterprise', 'deployment', 'sso', 'scim', 'admin']),
    'enterpriseDeployment',
    resolution
  );
  const recommendation = deriveRecommendation(
    euDataResidency.status,
    enterpriseDeployment.status
  );

  return enterpriseReadinessSchema.parse({
    companyName,
    researchedAt: new Date().toISOString(),
    overview: vendorSummary.slice(0, 420),
    executiveSummary:
      sections.preliminaryVerdict || buildExecutiveSummary(companyName, recommendation),
    recommendation,
    deploymentVerdict:
      sections.preliminaryVerdict ||
      'Security analyst verdict generated from the live research memo.',
    guardrails: {
      euDataResidency,
      enterpriseDeployment
    },
    unansweredQuestions: extractListItems(sections.unansweredQuestions),
    nextSteps: buildNextSteps(recommendation)
  });
}

function parseMemoSections(memo: string) {
  const sectionAliases = {
    vendor: ['Vendor'],
    euDataResidency: ['EU data residency', 'Data residency', 'EU residency'],
    enterpriseDeployment: [
      'Enterprise deployment',
      'Deployment',
      'Enterprise controls'
    ],
    unansweredQuestions: ['Unanswered questions', 'Open questions'],
    preliminaryVerdict: ['Preliminary verdict', 'Verdict']
  } as const;
  const sections: Record<string, string> = {
    vendor: '',
    euDataResidency: '',
    enterpriseDeployment: '',
    unansweredQuestions: '',
    preliminaryVerdict: ''
  };
  const allAliases = Object.values(sectionAliases).flat();
  const normalizedMemo = normalizeMemoHeadings(memo, allAliases);
  const canonicalHeadings = {
    vendor: 'Vendor',
    euDataResidency: 'EU data residency',
    enterpriseDeployment: 'Enterprise deployment',
    unansweredQuestions: 'Unanswered questions',
    preliminaryVerdict: 'Preliminary verdict'
  } as const;

  for (const [sectionKey, heading] of Object.entries(canonicalHeadings)) {
    const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const remainingHeadings = Object.values(canonicalHeadings)
      .filter((candidate) => candidate !== heading)
      .map((candidate) => candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    const pattern = remainingHeadings
      ? new RegExp(
          `^${escapedHeading}:\\s*([\\s\\S]*?)(?=^(${remainingHeadings}):|\\Z)`,
          'im'
        )
      : new RegExp(`^${escapedHeading}:\\s*([\\s\\S]*?)\\Z`, 'im');
    const match = normalizedMemo.match(pattern);

    if (match?.[1]) {
      sections[sectionKey] = match[1].replace(/\s+/g, ' ').trim();
    }
  }

  return sections as Record<keyof typeof sections, string>;
}

function normalizeMemoHeadings(memo: string, headings: string[]) {
  let normalized = memo.replace(/\r/g, '');

  for (const heading of headings) {
    const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    normalized = normalized.replace(
      new RegExp(`\\*\\*\\s*${escapedHeading}\\s*\\*\\*`, 'gi'),
      `\n${heading}:\n`
    );
    normalized = normalized.replace(
      new RegExp(`(^|\\n)\\s*${escapedHeading}\\s*:?(?=\\s|\\n|$)`, 'gi'),
      (_match, prefix) => `${prefix}${heading}:\n`
    );
  }

  normalized = normalized
    .replace(/\nData residency:/gi, '\nEU data residency:\n')
    .replace(/\nEU residency:/gi, '\nEU data residency:\n')
    .replace(/\nDeployment:/gi, '\nEnterprise deployment:\n')
    .replace(/\nEnterprise controls:/gi, '\nEnterprise deployment:\n')
    .replace(/\nOpen questions:/gi, '\nUnanswered questions:\n')
    .replace(/\nVerdict:/gi, '\nPreliminary verdict:\n');

  return normalized.replace(/\n{3,}/g, '\n\n');
}

function buildAssessment(
  sectionText: string,
  guardrailKey: GuardrailKey,
  resolution: VendorResolution
) {
  const normalized = cleanSectionText(
    sectionText.trim() || 'Unknown based on current research memo.'
  );
  const summary = summarizeAssessment(normalized);
  const urls = extractUrls(normalized, resolution.officialDomains);
  const status = deriveStatus(guardrailKey, normalized, summary, urls.length);

  return {
    status,
    confidence: deriveConfidence(guardrailKey, normalized, summary, urls.length, status),
    summary,
    risks: deriveRisks(guardrailKey, normalized, summary, status),
    evidence: urls.map((url, index) => ({
      title: evidenceTitleFromUrl(url),
      url,
      publisher: publisherFromUrl(url),
      finding: buildEvidenceFinding(summary, index),
      sourceType: isPrimarySource(url) ? 'primary' : 'secondary'
    }))
  };
}

function cleanSectionText(text: string) {
  return text
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeAssessment(text: string) {
  const withoutSources = text
    .split(/\bSources?:/i)[0]
    .replace(
      /^(vendor|eu data residency|enterprise deployment|unanswered questions|preliminary verdict)\s*:\s*/i,
      ''
    )
    .replace(/https?:\/\/[^\s<>()]+/g, '')
    .replace(/\s+[;,:]\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return withoutSources || 'Unknown based on current research memo.';
}

function buildEvidenceFinding(summary: string, index: number) {
  if (index === 0) {
    return truncate(summary, 140);
  }

  return 'Supporting vendor documentation for this guardrail.';
}

function deriveStatus(
  guardrailKey: GuardrailKey,
  fullText: string,
  summary: string,
  evidenceCount: number
): StructuredReadinessReport['guardrails']['euDataResidency']['status'] {
  const lower = `${summary} ${fullText}`.toLowerCase();
  const hasPositiveSignal =
    guardrailKey === 'euDataResidency'
      ? /\bsupports? eu(?:[- ]only)? (?:hosting|storage|processing|residency)\b|\boffers? eu(?:[- ]only)? (?:hosting|storage|processing|residency)\b|\beu[- ]only (?:hosting|storage|processing|region)\b|\bhosted in (?:the )?eu\b|\bstored in (?:the )?eu\b|\bprocessed in (?:the )?eu\b|\beu region(?:s)?\b|\bdata region\b|\bregion pinning\b|\beuropean data cent(?:er|re)s?\b/.test(
          lower
        )
      : /\byes\b|\bsupports?\b|\boffers?\b|\benterprise deployment\b|\benterprise plan\b|\bsaml\b|\bscim\b|\baudit logs?\b|\badmin controls?\b|\bmanaged mode\b|\bcentrali[sz]ed\b|\bprovisioning\b|\blicense[- ]management api\b|\bprivate (cloud|deployment)\b|\bsingle[- ]tenant\b|\bdedicated\b|\bbyok\b/.test(
          lower
        );
  const hasNegativeSignal =
    guardrailKey === 'euDataResidency'
      ? /\bunsupported\b|\bnot supported\b|\bnot available\b|\bno evidence(?: found| of)?\b|\bno public evidence\b|\bdid not find\b|\bnot supported based on public evidence\b|\btransferred to\b|\bprocessed in the united states\b|\bstored in the united states\b|\bus east\b|\bus-based\b|\bhosted (?:in|on).{0,40}\bus\b|\boutside the eu\b|\bnot eu[- ]resident\b|\bnot kept in an eu-only region\b|\bnot the same as eu data residency\b/.test(
          lower
        )
      : /\bunsupported\b|\bnot supported\b|\bnot available\b|\bno enterprise\b|\bconsumer only\b|\bno sso\b|\bno scim\b|\blacks? admin controls?\b|\bnot offered on enterprise\b|\bno private deployment\b/.test(
          lower
        );
  const hasMixedSignal =
    guardrailKey === 'euDataResidency'
      ? /\bpartial\b|\blimited\b|\bhowever\b|\bbut\b|\beligible\b|\bcase-by-case\b|\bdefault\b|\bunless\b|\bconditional\b|\bdepends\b|\bcontractual\b|\bsafeguards\b|\bsccs?\b|\bdpf\b/.test(
          lower
        )
      : /\bpartial\b|\blimited\b|\bhowever\b|\bbut\b|\beligible\b|\bcase-by-case\b|\bdefault\b|\bunless\b|\bconditional\b|\bdepends\b|\bonly on some plans\b|\bcontact sales\b|\bcustom\b/.test(
          lower
        );
  const explicitlyUnknown =
    /\bunknown\b|\bunclear\b|\bnot publicly stated\b|\binsufficient\b|\bnot enough information\b|\bnot disclosed\b/.test(
      lower
    );

  if (hasPositiveSignal && hasNegativeSignal) {
    return 'partial';
  }

  if (hasNegativeSignal) {
    return 'unsupported';
  }

  if (hasPositiveSignal && hasMixedSignal) {
    return 'partial';
  }

  if (hasPositiveSignal) {
    return 'supported';
  }

  if (hasMixedSignal) {
    return 'partial';
  }

  if (explicitlyUnknown) {
    return 'unknown';
  }

  return evidenceCount > 0 ? 'partial' : 'unknown';
}

function deriveConfidence(
  guardrailKey: GuardrailKey,
  fullText: string,
  summary: string,
  evidenceCount: number,
  status: StructuredReadinessReport['guardrails']['euDataResidency']['status']
): 'high' | 'medium' | 'low' {
  const lower = `${summary} ${fullText}`.toLowerCase();
  const hasExplicitSignal =
    guardrailKey === 'euDataResidency'
      ? /\bno evidence\b|\bnot supported\b|\bhosts data\b|\bhosted\b|\btransferred to\b|\bstored in the united states\b|\bus east\b|\beu[- ]only\b|\beu region\b|\bregion pinning\b/.test(
          lower
        )
      : /\bnot supported\b|\bsaml\b|\bscim\b|\baudit logs?\b|\badmin controls?\b|\bprovisioning\b|\bprivate (cloud|deployment)\b|\bsingle[- ]tenant\b|\bdedicated\b/.test(
          lower
        );
  const hasDirectSourceCues =
    /\bour (security|privacy|compliance|dpa)\b|\bvendor\b|\bdocumentation\b|\bpolicy\b/.test(
      lower
    );

  if (status === 'unknown') {
    return 'low';
  }

  if (evidenceCount >= 2 && hasExplicitSignal) {
    return 'high';
  }

  if (hasExplicitSignal && (evidenceCount >= 1 || hasDirectSourceCues)) {
    return 'medium';
  }

  if (evidenceCount >= 1) {
    return 'medium';
  }

  return status === 'partial' ? 'low' : 'medium';
}

function deriveRisks(
  guardrailKey: GuardrailKey,
  fullText: string,
  summary: string,
  status: StructuredReadinessReport['guardrails']['euDataResidency']['status']
) {
  const lower = `${summary} ${fullText}`.toLowerCase();
  const risks: string[] = [];

  if (status === 'unknown' || /\bunknown\b|\bunclear\b/.test(lower)) {
    risks.push('Important evidence remains unclear from public sources.');
  }

  if (status === 'partial' || /\blimited\b|\bpartial\b|\beligible\b/.test(lower)) {
    risks.push(
      guardrailKey === 'euDataResidency'
        ? 'Residency posture appears conditional or compliance-based rather than EU-only by default.'
        : 'Enterprise controls appear conditional rather than universally available.'
    );
  }

  if (
    status === 'unsupported' ||
    (guardrailKey === 'euDataResidency'
      ? /\bnot available\b|\bunsupported\b|\bno evidence\b|\bhosted in.*us\b|\bus east\b|\bstored in the united states\b/.test(
          lower
        )
      : /\bnot available\b|\bunsupported\b|\bno enterprise\b|\bno sso\b|\bno scim\b|\blacks? admin controls?\b/.test(
          lower
        ))
  ) {
    risks.push(
      guardrailKey === 'euDataResidency'
        ? 'Public evidence indicates the vendor does not meet the EU residency guardrail.'
        : 'Public evidence indicates a gap in enterprise deployment readiness.'
    );
  }

  if (
    guardrailKey === 'enterpriseDeployment' &&
    status === 'supported' &&
    /\bno evidence of (?:on-prem|on premises|customer-hosted|private deployment)\b|\bvendor-hosted cloud only\b/.test(
      lower
    )
  ) {
    risks.push(
      'Available evidence supports enterprise SaaS controls, but not private or customer-hosted deployment.'
    );
  }

  if (risks.length === 0) {
    risks.push('Validate contract terms and implementation scope directly with the vendor.');
  }

  return risks.slice(0, 5);
}

function isAllowedVendorUrl(url: string, allowedDomains: string[]) {
  try {
    const hostname = normalizeHostname(new URL(url).hostname);

    return allowedDomains.some((domain) => {
      const normalizedDomain = normalizeHostname(domain);

      return (
        hostname === normalizedDomain ||
        hostname.endsWith(`.${normalizedDomain}`)
      );
    });
  } catch {
    return false;
  }
}

export {
  IncompleteResearchError,
  InvalidVendorInputError,
  MissingOpenAIKeyError,
  ResearchGenerationError,
  ResearchTimeoutError,
  VendorResolutionError
};

function extractUrls(text: string, allowedDomains: string[]) {
  const rawMatches = text.match(/https?:\/\/[^\s<>()]+/g) ?? [];

  return Array.from(
    new Set(
      rawMatches
        .map((url) => url.replace(/[`,.;:!?]+$/g, ''))
        .map((url) => url.replace(/[\]\[(){}]+$/g, ''))
        .map((url) => {
          try {
            const parsed = new URL(url);

            parsed.hash = '';
            ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(
              (key) => parsed.searchParams.delete(key)
            );

            const normalized = `${parsed.origin}${parsed.pathname}${
              parsed.search ? parsed.search : ''
            }`;

            return normalized.replace(/\/$/, '');
          } catch {
            return '';
          }
        })
        .filter((url) => isAllowedVendorUrl(url, allowedDomains))
        .filter(Boolean)
    )
  ).slice(0, 5);
}

function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

function evidenceTitleFromUrl(url: string) {
  try {
    const { hostname, pathname } = new URL(url);
    const tail = pathname.split('/').filter(Boolean).slice(-1)[0];

    return tail ? `${hostname} / ${tail}` : hostname;
  } catch {
    return 'Source';
  }
}

function publisherFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Unknown publisher';
  }
}

function isPrimarySource(url: string) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');

    return !/(reddit|g2|gartner|forrester|youtube|linkedin|x\.com|twitter)/.test(
      hostname
    );
  } catch {
    return false;
  }
}

function extractListItems(text: string) {
  if (!text.trim()) {
    return ['No specific unanswered questions were captured in the research memo.'];
  }

  const pieces = text
    .split(/\s(?=(?:-|\d+\.)\s)|\s(?=[A-Z][^.!?]{10,}[?])/)
    .map((item) => item.replace(/^[-*\d.\s]+/, '').trim())
    .filter(Boolean);

  return (pieces.length > 0 ? pieces : [text.trim()]).slice(0, 6);
}

function inferSectionFromMemo(memo: string, keywords: string[]) {
  const sentences = memo
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => cleanSectionText(sentence))
    .filter(Boolean);
  const matched = sentences.filter((sentence) =>
    keywords.some((keyword) => sentence.toLowerCase().includes(keyword))
  );

  return matched.slice(0, 3).join(' ') || 'Unknown based on current research memo.';
}

function deriveRecommendation(
  euStatus: StructuredReadinessReport['guardrails']['euDataResidency']['status'],
  deploymentStatus: StructuredReadinessReport['guardrails']['enterpriseDeployment']['status']
): StructuredReadinessReport['recommendation'] {
  if (euStatus === 'unsupported' || deploymentStatus === 'unsupported') {
    return 'red';
  }

  if (
    euStatus === 'partial' ||
    deploymentStatus === 'partial' ||
    euStatus === 'unknown' ||
    deploymentStatus === 'unknown'
  ) {
    return 'yellow';
  }

  return 'green';
}

function buildExecutiveSummary(
  companyName: string,
  recommendation: StructuredReadinessReport['recommendation']
) {
  const posture =
    recommendation === 'green'
      ? 'looks acceptable from a security review perspective'
      : recommendation === 'yellow'
        ? 'shows mixed security and deployment signals'
        : 'shows material security-review risk';

  return `${companyName} ${posture}, with the strongest emphasis on EU data residency and enterprise deployment posture. This is an evidence-based security assessment, and the confidence level reflects how explicit the public vendor documentation is.`;
}

function buildNextSteps(recommendation: StructuredReadinessReport['recommendation']) {
  const steps = [
    'Review the cited vendor documentation directly.',
    'Confirm data residency and deployment terms in writing with the vendor.',
    'Validate plan-specific controls such as SSO, SCIM, audit logs, and contractual commitments.'
  ];

  if (recommendation !== 'green') {
    steps.unshift('Escalate the guardrail gap before approving the vendor.');
  }

  return steps.slice(0, 6);
}
