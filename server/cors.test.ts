import assert from 'node:assert/strict';
import test from 'node:test';
import type express from 'express';
import { isAllowedCorsOrigin, isLoopbackOrigin } from './cors.js';

test('isLoopbackOrigin accepts bracketed IPv6 loopback origins', () => {
  assert.equal(isLoopbackOrigin('http://[::1]:5173'), true);
});

test('isLoopbackOrigin rejects non-loopback origins', () => {
  assert.equal(isLoopbackOrigin('https://evil.example'), false);
});

test('isAllowedCorsOrigin allows IPv6 loopback in non-production', () => {
  const req = {
    get: () => undefined,
    protocol: 'http'
  } as unknown as express.Request;

  assert.equal(
    isAllowedCorsOrigin(req, 'http://[::1]:5173', new Set<string>(), 'development'),
    true
  );
});
