import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import cors from 'cors';
import express from 'express';
import { evaluatePublicSurfaceCases, runPublicSurfaceSmokeSuite } from './runPublicSurfaceEvals.js';
import { publicSurfaceCaseSchema, type PublicSurfaceCase } from './publicSurfaceCaseSchema.js';

test('public surface smoke suite passes on the current production-style server', async () => {
  const summary = await runPublicSurfaceSmokeSuite();

  assert.equal(summary.totals.failed, 0);
  assert.equal(summary.totals.passed, summary.totals.cases);
});

test('public surface smoke suite reports targeted failures on a weakened server', async (t) => {
  const app = express();

  app.use(
    cors({
      origin: true
    })
  );
  app.use(express.json());
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      database: {
        configured: true,
        ok: true
      }
    });
  });
  app.get('/api/internal/health', (_req, res) => {
    res.json({
      ok: true,
      database: {
        configured: true,
        ok: true
      }
    });
  });
  app.post('/api/chat/test', (_req, res) => {
    res.json({
      ok: true
    });
  });
  app.options('/api/chat', (_req, res) => {
    res.status(204).set('Access-Control-Allow-Origin', '*').end();
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Expected an ephemeral TCP port for public-surface smoke tests.');
  }

  const cases = buildFailureProbeCases();
  const summary = await evaluatePublicSurfaceCases(
    `http://127.0.0.1:${address.port}`,
    cases
  );

  assert.ok(summary.totals.failed > 0);
  assert.ok(
    summary.results.some(
      (result) =>
        result.outcome === 'failed' &&
        /access-control-allow-origin|content-security-policy|expected status 404/i.test(
          result.detail
        )
    )
  );
});

function buildFailureProbeCases(): PublicSurfaceCase[] {
  return [
    publicSurfaceCaseSchema.parse({
      id: 'failure-cors-untrusted-origin',
      category: 'cors',
      notes: 'Weak server should fail when it reflects an evil origin.',
      request: {
        method: 'GET',
        path: '/api/health',
        headers: {
          origin: 'https://evil.example'
        }
      },
      expected: {
        status: 200,
        absentHeaders: ['access-control-allow-origin']
      }
    }),
    publicSurfaceCaseSchema.parse({
      id: 'failure-missing-csp',
      category: 'security-headers',
      notes: 'Weak server should fail when CSP is missing.',
      request: {
        method: 'GET',
        path: '/api/health'
      },
      expected: {
        status: 200,
        headerContains: {
          'content-security-policy': ["default-src 'self'"]
        }
      }
    }),
    publicSurfaceCaseSchema.parse({
      id: 'failure-exposed-internal-health',
      category: 'endpoint-exposure',
      notes: 'Weak server should fail when internal health is public.',
      request: {
        method: 'GET',
        path: '/api/internal/health'
      },
      expected: {
        status: 404
      }
    })
  ];
}
