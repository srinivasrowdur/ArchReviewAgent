export type ReadinessStatus = 'supported' | 'partial' | 'unsupported' | 'unknown';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type RecommendationLevel = 'green' | 'yellow' | 'red';
export type SourceType = 'primary' | 'secondary';
export type ResearchProgressStage =
  | 'starting'
  | 'searching'
  | 'reviewing_eu'
  | 'reviewing_deployment'
  | 'synthesizing'
  | 'finalizing';

export interface EvidenceItem {
  title: string;
  url: string;
  publisher: string;
  finding: string;
  sourceType: SourceType;
}

export interface GuardrailAssessment {
  status: ReadinessStatus;
  confidence: ConfidenceLevel;
  summary: string;
  risks: string[];
  evidence: EvidenceItem[];
}

export interface EnterpriseReadinessReport {
  companyName: string;
  researchedAt: string;
  overview: string;
  executiveSummary: string;
  recommendation: RecommendationLevel;
  deploymentVerdict: string;
  guardrails: {
    euDataResidency: GuardrailAssessment;
    enterpriseDeployment: GuardrailAssessment;
  };
  unansweredQuestions: string[];
  nextSteps: string[];
}

export interface ResearchRequest {
  companyName: string;
  refresh?: boolean;
}

export interface ResearchResponse {
  mode?: 'live' | 'test';
  report: EnterpriseReadinessReport;
}

export interface ResearchProgressUpdate {
  stage: ResearchProgressStage;
  label: string;
}

export const liveResearchStages = [
  { stage: 'starting', label: 'Starting security review' },
  { stage: 'searching', label: 'Searching vendor documentation' },
  { stage: 'reviewing_eu', label: 'Reviewing EU residency evidence' },
  {
    stage: 'reviewing_deployment',
    label: 'Reviewing enterprise deployment evidence'
  },
  { stage: 'synthesizing', label: 'Synthesizing analyst verdict' },
  { stage: 'finalizing', label: 'Finalizing report' }
] as const satisfies readonly ResearchProgressUpdate[];

export const criticalGuardrails = [
  {
    key: 'euDataResidency',
    label: 'EU data residency',
    description: 'Explicit evidence for EU storage, processing, or region pinning.'
  },
  {
    key: 'enterpriseDeployment',
    label: 'Enterprise deployment',
    description: 'Hosted region controls, private deployment, SSO, SCIM, and admin features.'
  }
] as const;
