import type express from 'express';

export const internalApiTokenHeader = 'x-internal-api-token';

type DatabaseHealth = {
  configured: boolean;
  ok: boolean;
};

export function getPublicHealthResponse() {
  return {
    status: 200,
    body: {
      ok: true
    }
  };
}

export function getDetailedHealthResponse(database: DatabaseHealth) {
  const ok = !database.configured || database.ok;

  return {
    status: ok ? 200 : 503,
    body: {
      ok,
      database
    }
  };
}

export function isInternalApiAuthorized(
  req: express.Request,
  {
    nodeEnv = process.env.NODE_ENV,
    internalApiToken = process.env.INTERNAL_API_TOKEN ?? ''
  }: {
    nodeEnv?: string;
    internalApiToken?: string;
  } = {}
) {
  if (nodeEnv !== 'production') {
    return true;
  }

  const normalizedToken = internalApiToken.trim();

  if (!normalizedToken) {
    return false;
  }

  return req.get(internalApiTokenHeader) === normalizedToken;
}
