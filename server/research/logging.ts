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
