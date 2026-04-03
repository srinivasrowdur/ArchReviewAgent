export class MissingOpenAIKeyError extends Error {
  constructor() {
    super('OPENAI_API_KEY is not set.');
    this.name = 'MissingOpenAIKeyError';
  }
}

export class IncompleteResearchError extends Error {
  constructor() {
    super('The agent could not gather enough evidence for the required guardrails.');
    this.name = 'IncompleteResearchError';
  }
}

export class ResearchTimeoutError extends Error {
  constructor() {
    super('The live research run exceeded the allowed time budget.');
    this.name = 'ResearchTimeoutError';
  }
}

export class ResearchGenerationError extends Error {
  constructor() {
    super('The live research run failed before producing a final analyst memo.');
    this.name = 'ResearchGenerationError';
  }
}

export class InvalidVendorInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidVendorInputError';
  }
}

export class VendorResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VendorResolutionError';
  }
}

export function isAbortError(error: unknown) {
  const constructorName =
    error && typeof error === 'object' && 'constructor' in error
      ? (error.constructor as { name?: string }).name
      : undefined;

  return (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      error.name === 'TimeoutError' ||
      error.name === 'APIUserAbortError' ||
      constructorName === 'APIUserAbortError')
  );
}
