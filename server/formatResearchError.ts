import {
  IncompleteResearchError,
  InvalidVendorInputError,
  MissingOpenAIKeyError,
  ResearchDecisionError,
  ResearchGenerationError,
  ResearchTimeoutError,
  VendorResolutionError
} from './research/errors.js';

export function formatResearchError(error: unknown) {
  if (error instanceof MissingOpenAIKeyError) {
    return {
      status: 500,
      message: 'Set OPENAI_API_KEY before starting the backend.'
    };
  }

  if (error instanceof InvalidVendorInputError) {
    return {
      status: 400,
      message: error.message
    };
  }

  if (error instanceof VendorResolutionError) {
    return {
      status: 422,
      message: error.message
    };
  }

  if (error instanceof IncompleteResearchError) {
    return {
      status: 502,
      message:
        'The agent could not find enough evidence for EU residency and deployment guardrails. Try a more specific company or product name.'
    };
  }

  if (error instanceof ResearchTimeoutError) {
    return {
      status: 504,
      message:
        'Live research took too long. Retry, try a more specific vendor name, or use test mode for a fast UI check.'
    };
  }

  if (error instanceof ResearchGenerationError) {
    return {
      status: 502,
      message:
        'The live research run failed before producing a complete verdict. Retry once, or try a more specific vendor or product name.'
    };
  }

  if (error instanceof ResearchDecisionError) {
    return {
      status: 502,
      message:
        'The live research run failed while forming a final verdict. Retry once, or try a more specific vendor or product name.'
    };
  }

  return {
    status: 500,
    message: 'Unexpected backend error while running enterprise research.'
  };
}
