import { randomUUID } from 'node:crypto';

export function createResearchRunId() {
  return randomUUID().slice(0, 8);
}

export function logResearchEvent(
  event: string,
  fields: Record<string, unknown> = {}
) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      scope: 'research',
      event,
      ...fields
    })
  );
}

export function describeError(error: unknown) {
  if (error instanceof Error) {
    const errorClass =
      error.constructor && typeof error.constructor === 'function'
        ? error.constructor.name
        : 'Error';

    return {
      errorClass,
      errorName: error.name || errorClass,
      errorMessage: error.message
    };
  }

  return {
    errorClass: typeof error,
    errorName: 'NonErrorThrow',
    errorMessage: String(error)
  };
}

export function summarizeInputForLog(value: string, maxLength: number = 80) {
  const normalized = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return {
      preview: '',
      length: 0
    };
  }

  return {
    preview:
      normalized.length <= maxLength
        ? normalized
        : `${normalized.slice(0, maxLength - 3).trimEnd()}...`,
    length: normalized.length
  };
}
