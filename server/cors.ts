import type express from 'express';

export function isAllowedCorsOrigin(
  req: express.Request,
  requestOrigin: string | undefined,
  configuredAllowedOrigins: ReadonlySet<string>,
  nodeEnv = process.env.NODE_ENV
) {
  if (!requestOrigin) {
    return true;
  }

  if (configuredAllowedOrigins.has(requestOrigin)) {
    return true;
  }

  if (isSameOriginRequest(req, requestOrigin)) {
    return true;
  }

  if (nodeEnv !== 'production' && isLoopbackOrigin(requestOrigin)) {
    return true;
  }

  return false;
}

export function isSameOriginRequest(req: express.Request, requestOrigin: string) {
  try {
    const originUrl = new URL(requestOrigin);
    const host = req.get('x-forwarded-host') ?? req.get('host');
    const protocol = req.get('x-forwarded-proto') ?? req.protocol;

    return Boolean(host) && originUrl.host === host && originUrl.protocol === `${protocol}:`;
  } catch {
    return false;
  }
}

export function isLoopbackOrigin(requestOrigin: string) {
  try {
    const originUrl = new URL(requestOrigin);
    const hostname = normalizeOriginHostname(originUrl.hostname);

    return ['127.0.0.1', '::1', 'localhost'].includes(hostname);
  } catch {
    return false;
  }
}

function normalizeOriginHostname(hostname: string) {
  return hostname.replace(/^\[(.*)\]$/, '$1');
}
