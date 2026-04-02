import {
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
import { type ResearchProgressUpdate } from '../shared/contracts.js';
import { buildReportFromMemo } from './research/decisioning.js';
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
  return buildReportFromMemo(resolution.canonicalName, memo, resolution);
}

export {
  IncompleteResearchError,
  InvalidVendorInputError,
  MissingOpenAIKeyError,
  ResearchGenerationError,
  ResearchTimeoutError,
  VendorResolutionError
};
