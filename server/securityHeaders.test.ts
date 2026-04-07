import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { createSecurityHeadersMiddleware } from './securityHeaders.js';

test('production security headers include CSP and common hardening headers', async (t) => {
  const server = createServerWithSecurityHeaders('production');

  await once(server, 'listening');
  t.after(() => server.close());

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Expected an ephemeral TCP port.');
  }

  const response = await fetch(`http://127.0.0.1:${address.port}/`);
  const csp = response.headers.get('content-security-policy');

  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.ok(csp?.includes("default-src 'self'"));
  assert.ok(csp?.includes("frame-ancestors 'none'"));
  assert.ok(csp?.includes("font-src 'self' https://fonts.gstatic.com"));
});

test('development security headers skip CSP but keep other hardening headers', async (t) => {
  const server = createServerWithSecurityHeaders('development');

  await once(server, 'listening');
  t.after(() => server.close());

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Expected an ephemeral TCP port.');
  }

  const response = await fetch(`http://127.0.0.1:${address.port}/`);

  assert.equal(response.headers.get('content-security-policy'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});

function createServerWithSecurityHeaders(nodeEnv: string) {
  const app = express();

  app.disable('x-powered-by');
  app.use(createSecurityHeadersMiddleware(nodeEnv));
  app.get('/', (_req, res) => {
    res.json({ ok: true });
  });

  return app.listen(0);
}
