import assert from 'node:assert/strict';
import test from 'node:test';
import type express from 'express';
import {
  getDetailedHealthResponse,
  getPublicHealthResponse,
  internalApiTokenHeader,
  isInternalApiAuthorized
} from './publicSurface.js';

test('public health response hides database structure when database is not configured', () => {
  const response = getPublicHealthResponse({
    configured: false,
    ok: false
  });

  assert.deepEqual(response, {
    status: 200,
    body: {
      ok: true
    }
  });
});

test('public health response returns 503 when configured database is unhealthy', () => {
  const response = getPublicHealthResponse({
    configured: true,
    ok: false
  });

  assert.deepEqual(response, {
    status: 503,
    body: {
      ok: false
    }
  });
});

test('detailed health response includes database structure for internal callers', () => {
  const response = getDetailedHealthResponse({
    configured: true,
    ok: true
  });

  assert.deepEqual(response, {
    status: 200,
    body: {
      ok: true,
      database: {
        configured: true,
        ok: true
      }
    }
  });
});

test('internal API access is always allowed outside production', () => {
  const req = createRequest();

  assert.equal(
    isInternalApiAuthorized(req, {
      nodeEnv: 'development',
      internalApiToken: ''
    }),
    true
  );
});

test('internal API access is denied in production when no token is configured', () => {
  const req = createRequest();

  assert.equal(
    isInternalApiAuthorized(req, {
      nodeEnv: 'production',
      internalApiToken: ''
    }),
    false
  );
});

test('internal API access is allowed in production when the token matches', () => {
  const req = createRequest('secret-token');

  assert.equal(
    isInternalApiAuthorized(req, {
      nodeEnv: 'production',
      internalApiToken: 'secret-token'
    }),
    true
  );
});

function createRequest(internalToken?: string) {
  return {
    get(header: string) {
      if (header === internalApiTokenHeader) {
        return internalToken;
      }

      return undefined;
    }
  } as unknown as express.Request;
}
