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
  const seenActivities: string[] = [];
  const diagnostics: string[] = [];

  const memo = await generateResearchMemo(
    'Grammarly',
    resolution,
    Date.now(),
    30_000,
    (update) => seenStages.push(update.stage),
    async (_, __, options) => {
      assert.equal(options.maxTurns, 4);
      return createStreamResult([
        runItemEvent('tool_called', {
          type: 'hosted_tool_call',
          name: 'web_search',
          arguments: JSON.stringify({ query: 'Grammarly EU residency' })
        }),
        runItemEvent('tool_output', {
          type: 'hosted_tool_call',
          name: 'web_search',
          output: 'Top result: https://support.grammarly.com/hc/en-us/articles/example'
        }),
        textDeltaEvent('Vendor: Grammarly. EU data residency: Enterprise customers can select EU. '),
        textDeltaEvent(
          'Enterprise deployment: Supports SAML SSO and SCIM. Preliminary verdict: Yellow.'
        )
      ]);
    },
    {
      onActivity: (update) => seenActivities.push(update.label),
      onDiagnostic: (event) => diagnostics.push(event.event)
    }
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
  assert.deepEqual(seenActivities, [
    'Running search pass 1 across official vendor docs',
    'Searching official documentation on grammarly.com, support.grammarly.com',
    'Waiting for source matches from grammarly.com, support.grammarly.com',
    'Searching vendor documentation for “Grammarly EU residency”',
    'Reviewing retrieved source from support.grammarly.com',
    'Checking retrieved evidence for EU residency signals',
    'Checking retrieved evidence for enterprise deployment controls',
    'Synthesizing the analyst verdict from the gathered evidence'
  ]);
  assert.deepEqual(diagnostics, [
    'attempt_started',
    'first_stream_event',
    'tool_called',
    'tool_output',
    'first_text_delta',
    'stream_completed'
  ]);
});

test('generateResearchMemo uses a lower turn limit for background refresh', async () => {
  await generateResearchMemo(
    'Grammarly',
    resolution,
    Date.now(),
    30_000,
    undefined,
    async (_, __, options) => {
      assert.equal(options.maxTurns, 3);
      return createStreamResult([
        textDeltaEvent('Vendor: Grammarly. EU data residency: Enterprise customers can select EU. ')
      ]);
    },
    {
      backgroundRefresh: true
    }
  );
});

test('generateResearchMemo salvages partial memo on retryable stream error', async () => {
  const memo = await generateResearchMemo(
    'Grammarly',
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

test('generateResearchMemo emits retry activity when a search pass fails before usable output', async () => {
  const seenActivities: string[] = [];
  let calls = 0;

  const memo = await generateResearchMemo(
    'Palantir',
    {
      canonicalName: 'Palantir',
      officialDomains: ['palantir.com', 'palantirfoundry.com'],
      confidence: 'high',
      alternatives: [],
      rationale: 'Resolved to the analytics vendor.'
    },
    Date.now(),
    30_000,
    undefined,
    async () => {
      calls += 1;

      if (calls === 1) {
        return createStreamResult([], new Error('Model did not produce a final response!'));
      }

      return createStreamResult([
        textDeltaEvent(
          'Vendor: Palantir. EU data residency: No explicit EU region commitment found. Enterprise deployment: Supports enterprise deployment controls. Preliminary verdict: Red.'
        )
      ]);
    },
    {
      onActivity: (update) => seenActivities.push(update.label)
    }
  );

  assert.match(memo, /Vendor: Palantir\./);
  assert.ok(
    seenActivities.includes(
      'Retrying the vendor search because the previous pass did not return a usable answer'
    )
  );
  assert.ok(seenActivities.includes('Running search pass 2 across official vendor docs'));
});

test('generateResearchMemo ignores non-string tool outputs when building source-review activity', async () => {
  const seenActivities: string[] = [];

  const memo = await generateResearchMemo(
    'Grammarly',
    resolution,
    Date.now(),
    30_000,
    undefined,
    async () =>
      createStreamResult([
        runItemEvent('tool_output', {
          type: 'hosted_tool_call',
          name: 'web_search',
          output: {
            type: 'text',
            text: 'Top result payload'
          }
        }),
        textDeltaEvent(
          'Vendor: Grammarly. EU data residency: Enterprise customers can select EU. Enterprise deployment: Supports SAML SSO. Preliminary verdict: Yellow.'
        )
      ]),
    {
      onActivity: (update) => seenActivities.push(update.label)
    }
  );

  assert.match(memo, /Vendor: Grammarly\./);
  assert.ok(seenActivities.includes('Reviewing retrieved vendor evidence'));
});

test('generateResearchMemo maps abort-like failures to ResearchTimeoutError', async () => {
  await assert.rejects(
    () =>
      generateResearchMemo(
        'Grammarly',
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

function runItemEvent(
  name: 'tool_called' | 'tool_output',
  rawItem?: Record<string, unknown>
) {
  return {
    type: 'run_item_stream_event',
    name,
    item: {
      rawItem
    }
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
