import assert from 'node:assert/strict';
import test from 'node:test';
import { createEnterpriseApp } from './app.js';
import { createMockReport } from './mockReport.js';
import { ResearchTimeoutError } from './research/errors.js';

type CapturedMetric = {
  event: string;
  fields: Record<string, unknown> | undefined;
};

test('JSON chat route emits success and invalid-input API metrics', async (t) => {
  const emittedMetrics: CapturedMetric[] = [];
  const app = createEnterpriseApp({
    nodeEnv: 'test',
    serveStatic: false,
    researchCompanyFn: async (companyName) => createMockReport(companyName),
    logMetricFn: (event, fields) => {
      emittedMetrics.push({ event, fields });
    }
  });
  const server = app.listen(0);

  t.after(() => {
    server.close();
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Expected an ephemeral TCP port for test server.');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  const successResponse = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      companyName: 'Miro'
    })
  });

  const invalidResponse = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      companyName: 'a'
    })
  });

  assert.equal(successResponse.status, 200);
  assert.equal(invalidResponse.status, 400);

  const successMetric = emittedMetrics.find(
    (entry) =>
      entry.event === 'api_request_summary' &&
      entry.fields?.route === '/api/chat' &&
      entry.fields?.result === 'success'
  );
  const invalidMetric = emittedMetrics.find(
    (entry) =>
      entry.event === 'api_request_summary' &&
      entry.fields?.route === '/api/chat' &&
      entry.fields?.status === 400
  );

  assertMetricFields(successMetric);
  assert.equal(successMetric.fields.transport, 'json');
  assertMetricFields(invalidMetric);
  assert.equal(invalidMetric.fields.result, 'client_error');
});

test('JSON chat route emits server-error API metrics for timeout failures', async (t) => {
  const emittedMetrics: CapturedMetric[] = [];
  const app = createEnterpriseApp({
    nodeEnv: 'test',
    serveStatic: false,
    researchCompanyFn: async () => {
      throw new ResearchTimeoutError();
    },
    logMetricFn: (event, fields) => {
      emittedMetrics.push({ event, fields });
    }
  });
  const server = app.listen(0);

  t.after(() => {
    server.close();
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Expected an ephemeral TCP port for test server.');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      companyName: 'Palantir'
    })
  });

  assert.equal(response.status, 504);

  const timeoutMetric = emittedMetrics.find(
    (entry) =>
      entry.event === 'api_request_summary' &&
      entry.fields?.route === '/api/chat' &&
      entry.fields?.status === 504
  );

  assertMetricFields(timeoutMetric);
  assert.equal(timeoutMetric.fields.result, 'server_error');
  assert.equal(timeoutMetric.fields.timeout, true);
});

test('SSE chat route emits success metrics when the final result is delivered', async (t) => {
  const emittedMetrics: CapturedMetric[] = [];
  const app = createEnterpriseApp({
    nodeEnv: 'test',
    serveStatic: false,
    researchCompanyFn: async (companyName, options) => {
      options?.onProgress?.({ stage: 'starting', label: 'Starting security review' });
      return createMockReport(companyName);
    },
    logMetricFn: (event, fields) => {
      emittedMetrics.push({ event, fields });
    }
  });
  const server = app.listen(0);

  t.after(() => {
    server.close();
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Expected an ephemeral TCP port for test server.');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${baseUrl}/api/chat/stream`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      companyName: 'Miro'
    })
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /event: result/);

  const successMetric = emittedMetrics.find(
    (entry) =>
      entry.event === 'api_request_summary' &&
      entry.fields?.route === '/api/chat/stream' &&
      entry.fields?.result === 'success'
  );

  assertMetricFields(successMetric);
  assert.equal(successMetric.fields.transport, 'sse');
  assert.equal(successMetric.fields.reportedStatus, null);
});

test('SSE chat route emits disconnect metrics when the client closes before the final result', async (t) => {
  const emittedMetrics: CapturedMetric[] = [];
  let resolveResearch: (() => void) | undefined;
  const researchReleased = new Promise<void>((resolve) => {
    resolveResearch = resolve;
  });
  let resolveDisconnectMetric: (() => void) | undefined;
  const disconnectMetricSeen = new Promise<void>((resolve) => {
    resolveDisconnectMetric = resolve;
  });
  const app = createEnterpriseApp({
    nodeEnv: 'test',
    serveStatic: false,
    researchCompanyFn: async (companyName, options) => {
      options?.onProgress?.({ stage: 'starting', label: 'Starting security review' });
      await researchReleased;
      return createMockReport(companyName);
    },
    logMetricFn: (event, fields) => {
      emittedMetrics.push({ event, fields });

      if (
        event === 'api_request_summary' &&
        fields?.route === '/api/chat/stream' &&
        fields?.result === 'stream_disconnected'
      ) {
        resolveDisconnectMetric?.();
      }
    }
  });
  const server = app.listen(0);

  t.after(() => {
    server.close();
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Expected an ephemeral TCP port for test server.');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${baseUrl}/api/chat/stream`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      companyName: 'Miro'
    })
  });

  assert.equal(response.status, 200);
  await response.body?.cancel();
  resolveResearch?.();
  await disconnectMetricSeen;

  const disconnectMetric = emittedMetrics.find(
    (entry) =>
      entry.event === 'api_request_summary' &&
      entry.fields?.route === '/api/chat/stream' &&
      entry.fields?.result === 'stream_disconnected'
  );

  assertMetricFields(disconnectMetric);
  assert.equal(disconnectMetric.fields.reportedStatus, 499);
  assert.equal(disconnectMetric.fields.errorClass, 'ClientDisconnected');
});

function assertMetricFields(
  metric: CapturedMetric | undefined
): asserts metric is { event: string; fields: Record<string, unknown> } {
  assert.ok(metric);
  assert.ok(metric.fields);
}
