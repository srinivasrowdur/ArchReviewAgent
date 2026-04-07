# Evaluation Plan

This document defines the evaluation strategy for `ArchReviewAgent`.

It has two goals:

1. give release confidence before code ships
2. explain how to measure quality and drift in production after release

The plan is grounded in the current production architecture described in [architecture.md](../architecture.md):

- vendor intake and subject resolution
- evidence retrieval
- structured decisioning
- report presentation
- Postgres-backed cache and background refresh

It is also designed to evolve into the future-state architecture in [docs/extensible-guardrail-architecture.md](./extensible-guardrail-architecture.md).

## 1. Principles

The evaluation program should follow these principles:

- Evaluate the system by stage, not just by final answer.
- Prefer production-like cases over synthetic prompt trivia.
- Use deterministic checks where possible.
- Use model graders for nuanced judgment calls.
- Keep a small human calibration loop so grader quality does not drift.
- Compare candidate branches against a stable baseline instead of looking only at absolute scores.
- Store enough trace and evidence data to explain why a run changed.

For OpenAI-specific guidance that informed this plan, see:

- [Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
- [Graders](https://developers.openai.com/api/docs/guides/graders)
- [Trace grading](https://developers.openai.com/api/docs/guides/trace-grading)
- [GPT-5.4 model docs](https://developers.openai.com/api/docs/models/gpt-5.4)

## 2. Evaluation Objectives

### 2.1 Release Confidence

Before a release, the system should answer:

- Did subject resolution regress?
- Did evidence quality regress?
- Did guardrail verdicts regress?
- Did recommendation quality regress?
- Did security or operational controls regress?
- Did latency or timeout behavior regress materially?

### 2.2 Production Confidence

After release, the system should answer:

- Are live results drifting?
- Are `unknown` outcomes increasing?
- Are cache refreshes improving results or degrading them?
- Are product-level requests collapsing to parent-company summaries?
- Are failures concentrated in intake, retrieval, decisioning, or presentation?

## 3. Scope

The initial evaluation scope is the current product:

- fixed guardrails:
  - EU data residency
  - enterprise deployment
- current contract in [shared/contracts.ts](../shared/contracts.ts)
- current staged backend in:
  - [server/research/vendorIntake.ts](../server/research/vendorIntake.ts)
  - [server/research/retrieval.ts](../server/research/retrieval.ts)
  - [server/research/decisioning.ts](../server/research/decisioning.ts)
  - [server/research/presentation.ts](../server/research/presentation.ts)
  - [server/researchAgent.ts](../server/researchAgent.ts)

The plan should be extensible so the same framework can support additional guardrails later.

## 4. Evaluation Layers

Use three evaluation layers together.

### 4.1 Deterministic Checks

These are hard assertions that should not be subjective.

Examples:

- input validation rejects malformed or prompt-injection-like inputs
- CORS rejects untrusted origins
- production security headers are present
- public health output stays minimal
- report JSON matches the shared contract
- cache promotion rejects weaker candidates
- official-domain filtering is enforced

These are good release gates because they are stable and cheap.

### 4.2 Model Graders

Use model graders where the answer is semantic rather than exact string matching.

Examples:

- Is the product overview accurate?
- Is the EU residency verdict supported by the cited evidence?
- Is the enterprise deployment verdict supported by the cited evidence?
- Is the overall recommendation more optimistic than the evidence justifies?
- Is the answer anchored to the requested product rather than the parent company?

Model graders should score structured criteria, not vague "is this good?" prompts.

### 4.3 Human Calibration

Keep a small recurring human review loop for:

- newly failing release cases
- all recommendation changes
- all `unknown` outputs
- low-confidence or low-grader-score production samples

Human review should be used to calibrate the graders, not replace them.

## 5. Stage-Based Evaluation Map

The current system should be evaluated by stage.

### 5.1 Intake and Resolution

Files:

- [server/research/vendorIntake.ts](../server/research/vendorIntake.ts)
- [server/db/researchCacheRepository.ts](../server/db/researchCacheRepository.ts)

Questions:

- Was the requested subject understood correctly?
- Was product specificity preserved?
- Was the canonical vendor reasonable?
- Were official domains correct?
- Did spelling variants converge to the same cached identity?

Primary metrics:

- subject exact match rate
- canonical vendor match rate
- official-domain precision
- typo and alias convergence rate
- ambiguity handling accuracy

### 5.2 Retrieval

Files:

- [server/research/retrieval.ts](../server/research/retrieval.ts)
- [server/research/logging.ts](../server/research/logging.ts)

Questions:

- Did retrieval find usable evidence?
- Was evidence primarily from trusted domains?
- Was evidence sufficient for both guardrails?
- Did retrieval preserve product specificity?
- Did retrieval time out or fail to produce a memo?

Primary metrics:

- memo generation success rate
- memo length distribution
- evidence item count per guardrail
- first-party evidence ratio
- retrieval timeout rate
- retrieval failure rate

### 5.3 Decisioning

Files:

- [server/research/decisioning.ts](../server/research/decisioning.ts)
- [server/research/cachePolicy.ts](../server/research/cachePolicy.ts)

Questions:

- Are guardrail statuses correct?
- Is confidence reasonable?
- Is the recommendation justified by the evidence?
- Is the answer more optimistic than the evidence allows?
- Does refresh promotion prevent weaker evidence from replacing stronger evidence?

Primary metrics:

- guardrail status accuracy
- recommendation accuracy
- confidence calibration quality
- recommendation optimism violation rate
- cache promotion acceptance rate
- weak-candidate rejection rate

### 5.4 Presentation

Files:

- [server/research/presentation.ts](../server/research/presentation.ts)
- [src/App.tsx](../src/App.tsx)

Questions:

- Does the final report conform to contract?
- Is the `What this product does` section accurate and non-generic?
- Does markdown render safely and correctly?
- Are citations, risks, questions, and next steps coherent?

Primary metrics:

- schema validity rate
- markdown rendering regression rate
- product overview accuracy
- report completeness score

### 5.5 Operational and Security Surface

Files:

- [server/index.ts](../server/index.ts)
- [server/cors.ts](../server/cors.ts)
- [server/securityHeaders.ts](../server/securityHeaders.ts)
- [server/publicSurface.ts](../server/publicSurface.ts)

Questions:

- Are public endpoints limited correctly?
- Are browser hardening headers present?
- Is CORS restricted correctly?
- Are latency and error budgets acceptable?

Primary metrics:

- 5xx rate
- timeout rate
- public endpoint exposure regressions
- security smoke-test pass rate

## 6. Case Dataset Design

Create a versioned eval dataset in the repo.

Recommended structure:

```text
evals/
  cases/
    release-core.jsonl
    release-edge.jsonl
    security.jsonl
    production-shadow.jsonl
  graders/
    release/
    production/
  reports/
    <timestamp>/
```

The initial case schema and local validator should live at:

- [evals/caseSchema.ts](../evals/caseSchema.ts)
- [evals/validateCases.ts](../evals/validateCases.ts)

Each case should be one JSON object in JSONL format.

Suggested schema:

```json
{
  "id": "fabric-product-specificity",
  "category": "product-vs-parent",
  "input": "Microsoft Fabric",
  "expected_subject": "Microsoft Fabric",
  "expected_vendor": "Microsoft",
  "expected_official_domains": [
    "fabric.microsoft.com",
    "learn.microsoft.com",
    "microsoft.com"
  ],
  "expected_guardrails": {
    "euDataResidency": {
      "status": "supported",
      "allow_equivalents": ["partial"]
    },
    "enterpriseDeployment": {
      "status": "supported"
    }
  },
  "expected_recommendation": "green",
  "allowed_unknowns": [],
  "notes": "Should stay anchored to product, not collapse to generic Microsoft overview."
}
```

### 6.1 First Case Categories

Seed the first dataset with at least these categories:

1. normal well-documented vendors
2. product under large parent company
3. typo and alias resolution
4. ambiguous names
5. prompt-injection attempts
6. URL-like inputs
7. malformed short inputs
8. insufficient-evidence vendors
9. non-English documentation
10. EU residency supported but plan-scoped
11. transfer-law-only cases that should not count as residency support
12. enterprise deployment with strong admin features
13. enterprise deployment with only marketing language
14. stale-doc source rotation
15. vendor domain changes or multiple official domains
16. known weak cache baseline followed by stronger evidence
17. cached report should be reused on repeat lookup
18. background refresh should not regress an accepted baseline
19. markdown-heavy output rendering
20. security surface checks for public endpoints and CORS

## 7. Deterministic Graders

These should run first and fail fast.

### 7.1 Contract and Schema

- response parses against [shared/contracts.ts](../shared/contracts.ts)
- `researchedAt` is ISO-like and non-empty
- each guardrail has:
  - `status`
  - `confidence`
  - `summary`
  - `risks`
  - `evidence`
- recommendation is one of `green | yellow | red`

### 7.2 Input Safety

- malformed inputs rejected
- prompt-like or tool-instruction inputs rejected
- inputs shorter than minimum length rejected

### 7.3 Source Safety

- evidence URLs present
- evidence URLs use allowed schemes
- evidence stays within trusted domain rules where policy requires it

### 7.4 Cache and Promotion

- weaker candidates do not replace stronger accepted baselines
- spelling variants converge to the same accepted subject baseline
- refresh can improve a baseline without duplicating cache buckets

### 7.5 Public Security Surface

- untrusted CORS origins do not get browser approval
- production root has required security headers
- public `/api/health` stays minimal
- `/api/internal/health` is not public without internal authorization
- `/api/chat/test` is not publicly reachable in production

## 8. Model Graders

Model graders should evaluate structured outputs, not free-form vibes.

### 8.1 Product and Resolution Graders

Questions:

- Is the report about the requested product, not just the parent company?
- Is the `What this product does` section factual and specific?
- Is the official-domain set reasonable for this subject?

### 8.2 Evidence Support Graders

Questions:

- Does the EU residency verdict follow from the cited evidence?
- Does the enterprise deployment verdict follow from the cited evidence?
- Are the cited findings relevant to the claimed guardrail?
- Is the report using generic company text where product-specific evidence exists?

### 8.3 Recommendation Graders

Questions:

- Is the final recommendation too optimistic?
- Is the recommendation too pessimistic?
- Are open questions and next steps appropriate given the evidence quality?

### 8.4 Presentation Graders

Questions:

- Is the report coherent for an analyst?
- Are risks, unanswered questions, and next steps non-redundant?
- Is the overview concise and accurate?

### 8.5 Grader Output Shape

Use a structured grader response such as:

```json
{
  "pass": true,
  "score": 0.92,
  "reason": "The verdict is well supported by primary vendor evidence.",
  "flags": []
}
```

Recommended flags:

- `product_drift`
- `unsupported_verdict`
- `optimistic_recommendation`
- `generic_overview`
- `thin_evidence`
- `irrelevant_citations`

## 9. Human Calibration Loop

Review a small sample every week.

Minimum review queue:

- all newly failing release cases
- all cases where recommendation changed from the last baseline
- all cases with any `unknown`
- all production samples with grader score below threshold
- all product-vs-parent failures

Reviewer checklist:

- Was the subject resolved correctly?
- Were trusted domains appropriate?
- Did the guardrail status match the evidence?
- Was the recommendation justified?
- Did the overview stay specific to the product?

Use the review to:

- correct dataset expectations
- improve grader prompts
- identify new case categories

## 10. Release Evaluation Workflow

Run release evals against:

- `main` baseline
- candidate branch or release commit

Use the same dataset for both runs and compare results.

### 10.1 Release Environments

Prefer a production-parallel setup:

- same Postgres-backed cache path enabled
- same OpenAI model snapshot
- same env defaults except secrets and origin settings

### 10.2 Model Versioning

For release evals, pin a dated model snapshot instead of a moving alias when practical.

Reason:

- code changes and model changes should be separable
- release comparisons are easier to trust when the model is fixed

Production may use the alias for freshness, but snapshot-to-snapshot comparisons should happen before changing production model settings.

### 10.3 Release Gate Recommendation

Recommended release thresholds for the current product:

- deterministic checks: `100%`
- prompt-injection rejection: `100%`
- public security smoke tests: `100%`
- subject resolution exact or approved-equivalent: `>= 95%`
- guardrail status exact or approved-equivalent: `>= 90%`
- recommendation exact or approved-equivalent: `>= 90%`
- product overview accuracy: `>= 90%`
- no material increase in timeout rate
- no material increase in `unknown` rate

These thresholds are intentionally pragmatic. They should tighten as the dataset matures.

### 10.4 Required Manual Review Before Ship

Require review of:

- every new failing case
- every changed recommendation
- every case that moved to `unknown`
- every regression in product specificity

## 11. Production Evaluation Program

Release evals are not enough. Production needs ongoing scoring.

### 11.1 Structured Trace Fields

The current logging in [server/research/logging.ts](../server/research/logging.ts) and [server/researchAgent.ts](../server/researchAgent.ts) already captures useful stage boundaries.

Track these fields per run:

- run id
- requested input
- canonical subject
- canonical vendor
- official domains
- cache hit / miss / background refresh
- memo length
- guardrail statuses
- confidence values
- evidence counts
- recommendation
- phase timings
- error class and phase
- bundle id and promotion result

### 11.2 Live Metrics

Build a dashboard for:

- total requests
- cache hit rate
- background refresh rate
- refresh promotion rate
- 5xx rate
- 502 rate
- timeout rate
- `unknown` rate by guardrail
- product-drift rate
- average and p95 latency by stage

### 11.3 Sampled Shadow Grading

Sample a subset of live runs every day.

For each sampled run:

- keep the stored report
- keep evidence and metadata
- grade the result offline

Recommended production shadow grading questions:

- Was the overview accurate?
- Were the guardrail statuses supported by evidence?
- Was the recommendation justified?
- Did the output stay product-specific?

### 11.4 Weekly Human Review

Every week, review:

- low-scoring shadow-graded runs
- all `unknown` outputs from sampled production runs
- all refreshed runs that changed recommendation
- all high-latency failures

## 12. Cache-Specific Evaluation

The cache is part of product quality now, so it needs its own checks.

### 12.1 Cache Correctness

Verify:

- repeat requests hit accepted baselines
- aliases and spelling variants converge
- weak candidates do not replace stronger accepted reports
- stronger candidates can replace older baselines
- background refresh respects cooldown

### 12.2 Anti-Regression Checks

For cache-aware cases, compare:

- baseline bundle evidence counts
- candidate evidence counts
- status changes
- recommendation changes

At minimum, reject automatic promotion when:

- a guardrail falls to `unknown`
- a guardrail loses all evidence
- evidence count regresses materially without compensating strength

## 13. Security and Reliability Evals

Keep a permanent smoke suite for:

- CORS allowlist behavior
- security headers
- minimal public health
- internal endpoint protection
- test endpoint exposure rules
- markdown rendering safety
- report schema validity

These checks should run in CI and against production after deploy.

## 14. Suggested Repo Structure

Recommended incremental additions:

```text
docs/
  evaluation-plan.md
evals/
  cases/
  graders/
  reports/
scripts/
  run-release-evals.ts
  run-production-shadow-grading.ts
```

Suggested outputs:

- machine-readable JSON summary
- markdown comparison report for PRs and releases
- production weekly digest for sampled runs

## 15. Rollout Plan

Implement the evaluation program in four phases.

### Phase 1: Release Core

- create the first 50 to 100 curated cases
- add deterministic schema and security checks
- add branch-vs-main comparison output

### Phase 2: Semantic Graders

- add model graders for resolution, guardrails, recommendation, and overview quality
- add reviewer workflow for low-score cases

### Phase 3: Production Shadow Evals

- store enough production trace data for offline grading
- sample production runs daily
- add dashboards for live metrics and drift

### Phase 4: Guardrail Expansion Readiness

- generalize dataset and graders so additional guardrails can plug in without redesign
- align eval shapes with the future extensible guardrail architecture

## 16. Definition of Good

The evaluation system is good when:

- a release can be blocked by real regressions before shipping
- a production drift can be seen before users complain
- the team can explain why a recommendation changed
- the team can distinguish retrieval failures from decision failures
- the team can extend the product without rebuilding the eval system

## 17. Immediate Next Steps

The next concrete steps for this repo should be:

1. add `evals/cases/release-core.jsonl` with the first 20 to 30 curated cases
2. add deterministic checks for:
   - schema
   - input validation
   - cache promotion
   - public security surface
3. add a release runner that compares candidate branch results against `main`
4. add a production shadow-grading job for sampled live runs
5. review thresholds after the first two release cycles
