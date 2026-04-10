# Production Metrics

This project emits structured metric events to stdout so production log pipelines can derive drift and reliability metrics without adding a separate metrics backend first.

## Metric events

The application emits JSON lines with:

- `scope: "metric"`
- `event`
- stable event-specific fields

Current metric events:

### `api_request_summary`

Emitted by the HTTP layer for `/api/chat` and `/api/chat/stream`.

Fields:

- `route`
- `transport`
- `method`
- `status`
- `reportedStatus`
- `result`
- `durationMs`
- `refresh`
- `requestedSubjectName`
- `timeout`
- `errorClass`

Use this event for:

- request volume
- 4xx / 5xx rate on JSON requests
- timeout rate at the HTTP layer
- request latency

Notes:

- streamed failures still return HTTP `200` after the SSE session is established, so streamed failures are surfaced via `result: "stream_error"` plus `reportedStatus`
- client disconnects before the final SSE payload are surfaced via `result: "stream_disconnected"` with `reportedStatus: 499`
- JSON requests expose the actual status code directly in `status`

### `research_run_summary`

Emitted by the research workflow on:

- accepted-cache hit
- live success
- live failure

Fields:

- `runId`
- `requestedSubjectName`
- `subjectKey`
- `canonicalSubjectName`
- `canonicalVendorName`
- `outcome`
- `recommendation`
- `previousRecommendation`
- `recommendationChanged`
- `unknownGuardrails`
- `unknownGuardrailCount`
- `acceptedReportCache`
- `cacheHit`
- `resolutionSource`
- `backgroundRefresh`
- `forceRefresh`
- `streamed`
- `timeout`
- `errorPhase`
- `errorClass`
- `errorName`
- `totalDurationMs`
- `phaseTimings`

Use this event for:

- cache hit rate
- background refresh request mix
- timeout rate inside the research pipeline
- unknown rate by guardrail
- recommendation change rate versus the last accepted baseline
- stage latency distributions

### `background_refresh_event`

Emitted when background refresh work is:

- scheduled
- skipped
- completed
- failed

Fields:

- `runId`
- `subjectName`
- `subjectKey`
- `canonicalName`
- `state`
- `reason`
- `cooldownMs`
- `elapsedMs`
- `errorClass`

Use this event for:

- background refresh rate
- cooldown skip rate
- refresh failure rate

## Derived metrics

Recommended first metrics:

- request volume:
  count of `api_request_summary`
- cache hit rate:
  count of `research_run_summary.cacheHit = true` divided by non-background-refresh `research_run_summary`
- background refresh rate:
  count of `background_refresh_event.state = "scheduled"` divided by non-background-refresh `research_run_summary`
- timeout rate:
  count of `research_run_summary.timeout = true` divided by `research_run_summary`
- 5xx rate:
  count of `api_request_summary.status >= 500` divided by JSON `api_request_summary`
- unknown rate:
  count of `research_run_summary.unknownGuardrailCount > 0` divided by successful `research_run_summary`
- recommendation change rate:
  count of `research_run_summary.recommendationChanged = true` divided by successful runs with non-null `previousRecommendation`
- latency by stage:
  percentiles over `research_run_summary.phaseTimings`

## Local verification

1. Start the backend:

```bash
npm run dev:server
```

2. Trigger a successful live request:

```bash
curl -s http://localhost:8787/api/chat \
  -H 'content-type: application/json' \
  -d '{"companyName":"Miro"}' > /dev/null
```

3. Trigger a cache-hit path by repeating the same request:

```bash
curl -s http://localhost:8787/api/chat \
  -H 'content-type: application/json' \
  -d '{"companyName":"Miro"}' > /dev/null
```

4. Trigger a failure path:

```bash
curl -s http://localhost:8787/api/chat \
  -H 'content-type: application/json' \
  -d '{"companyName":"a"}'
```

5. Inspect the backend logs for metric events:

- `event: "api_request_summary"`
- `event: "research_run_summary"`
- `event: "background_refresh_event"`

6. For local semantic verification without live research, run the offline shadow-grading fixture:

```bash
npm run evals:run-production-shadow-grading -- --input-file evals/cases/_fixtures/shadow-traces.sample.jsonl
```

This writes JSON and Markdown outputs under `evals/reports/`.
