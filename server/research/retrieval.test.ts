import test from 'node:test';
import assert from 'node:assert/strict';
import type { RunStreamEvent } from '@openai/agents';
import { generateResearchMemo } from './retrieval.js';
import { ResearchTimeoutError } from './errors.js';
import type { VendorResolution } from './vendorIntake.js';

const resolution: VendorResolution = {
  canonicalName: 'Grammarly',
  officialDomains: ['grammarly.com', 'support.grammarly.com'],
  confidence: 'high',
  alternatives: [],
  rationale: 'Resolved to the SaaS vendor.'
};

test('generateResearchMemo assembles streamed text and emits ordered progress stages', async () => {
  const seenStages: string[] = [];

  const memo = await generateResearchMemo(
    resolution,
    Date.now(),
    30_000,
    (update) => seenStages.push(update.stage),
    async () =>
      createStreamResult([
        runItemEvent('tool_called'),
        textDeltaEvent('Vendor: Grammarly. EU data residency: Enterprise customers can select EU. '),
        textDeltaEvent(
          'Enterprise deployment: Supports SAML SSO and SCIM. Preliminary verdict: Yellow.'
        )
      ])
  );

  assert.match(memo, /Enterprise deployment: Supports SAML SSO and SCIM\./);
  assert.deepEqual(seenStages, [
    'starting',
    'searching',
    'reviewing_eu',
    'reviewing_deployment',
    'synthesizing',
    'finalizing'
  ]);
});

test('generateResearchMemo salvages partial memo on retryable stream error', async () => {
  const memo = await generateResearchMemo(
    resolution,
    Date.now(),
    30_000,
    undefined,
    async () =>
      createStreamResult(
        [
          textDeltaEvent(
            'Vendor: Grammarly. EU data residency: No evidence of EU-only residency. Enterprise deployment: Supports SAML SSO, SCIM, admin controls, and managed deployment options.'
          )
        ],
        new Error('Model did not produce a final response!')
      )
  );

  assert.match(memo, /EU data residency: No evidence of EU-only residency\./);
});

test('generateResearchMemo maps abort-like failures to ResearchTimeoutError', async () => {
  await assert.rejects(
    () =>
      generateResearchMemo(
        resolution,
        Date.now(),
        30_000,
        undefined,
        async () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          throw error;
        }
      ),
    (error: unknown) => error instanceof ResearchTimeoutError
  );
});

function createStreamResult(events: RunStreamEvent[], error?: unknown) {
  return {
    error,
    completed: Promise.resolve(),
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    }
  };
}

function runItemEvent(name: 'tool_called' | 'tool_output') {
  return {
    type: 'run_item_stream_event',
    name
  } as RunStreamEvent;
}

function textDeltaEvent(delta: string) {
  return {
    type: 'raw_model_stream_event',
    data: {
      type: 'output_text_delta',
      delta
    }
  } as RunStreamEvent;
}
