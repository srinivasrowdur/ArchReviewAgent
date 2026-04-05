# AGENTS.md

This file captures project-specific agent guidance for `ArchReviewAgent`.

It is meant to preserve the implementation and product expectations that were reinforced during development, so future changes stay aligned without re-learning the same constraints each time.

## 1. Product Purpose

`ArchReviewAgent` is a procurement-oriented security review application.

The user enters a company or product name, and the system:

1. identifies the correct subject and vendor owner
2. gathers public evidence from trusted vendor-controlled domains
3. evaluates enterprise guardrails
4. returns a structured, evidence-based recommendation

The app should feel like a security analyst assistant, not a generic chatbot.

## 2. Core Product Principles

### 2.1 Product-first, not parent-company-first

- Preserve product specificity whenever the user asks about a product under a broader vendor.
- Do not collapse `Microsoft Fabric`, `Power BI`, or similar subjects to `Microsoft` unless the evidence is genuinely only company-level.
- Retrieval, decisioning, and presentation should stay anchored to the requested subject whenever possible.

### 2.2 Evidence before verdict

- Final conclusions must be grounded in retrieved evidence.
- Prefer structured evidence and explicit citations over free-form memo interpretation.
- The verdict should never rely on stylistic phrasing alone.

### 2.3 `unknown` discipline

- Use `unknown` only when evidence is genuinely too thin.
- Do not use `unknown` because the model is merely cautious or wording is ambiguous.
- If public evidence supports a real conclusion, make the conclusion and attach an appropriate confidence level.

### 2.4 Support matters more than mention

- For guardrails like EU residency, decide whether the capability is actually supported for customers, not merely referenced.
- GDPR, SCCs, or transfer mechanisms are not the same as EU residency support.
- Enterprise deployment should be judged on meaningful enterprise controls, not generic enterprise marketing language.

### 2.5 Keep the user-facing UI simple

- Internal cache state, background refresh mechanics, and orchestration details should not be exposed in the primary UI unless explicitly requested.
- The app may use background refresh and cache promotion internally, but the user should see a simple research experience.
- Prefer a minimal `Refresh research` action over visible cache-status clutter.

## 3. Retrieval and Source Rules

### 3.1 Official-domain bias

- Prioritize vendor-controlled domains.
- Treat off-domain sources as secondary evidence unless there is a strong reason to include them.
- Vendor resolution should be used to determine the trusted domain set.

### 3.2 Resolve first, then search

- Do not launch broad live research before subject/vendor resolution.
- Use subject resolution to preserve product specificity and determine the trusted evidence boundary.

### 3.3 Log before guessing

- When live results are inconsistent, prefer adding structured logs at stage boundaries before rewriting logic blindly.
- Separate failures into:
  - intake
  - retrieval
  - decisioning
  - presentation
  - cache read/write

## 4. Architecture Preferences

### 4.1 Prefer staged pipelines

The preferred backend shape is:

`intake -> retrieval -> decision -> presentation`

Do not collapse everything into one large free-form agent step unless there is a compelling reason.

### 4.2 Collect once, evaluate many

- Retrieval should aim to produce reusable evidence artifacts.
- Future guardrail expansion should not require separate ad hoc retrieval flows for every new rule if the same evidence corpus can support several rules.

### 4.3 Rules should become configuration

- The current two guardrails are the present product scope, not the permanent architecture.
- Future growth should move toward a guardrail registry and recommendation engine rather than hardcoded branching.
- See [docs/extensible-guardrail-architecture.md](docs/extensible-guardrail-architecture.md) for the target-state design.

## 5. Cache and Consistency Rules

### 5.1 Cache by canonical subject

- Cache lookups and accepted baselines should use a stable canonical subject key, not raw typed user input.
- Spelling variants should resolve into the same accepted baseline when they refer to the same subject.

### 5.2 Do not let weak evidence displace strong evidence

- New evidence should not replace a stronger accepted baseline just because it is newer.
- Weak candidates may be stored for inspection, but they should not become the accepted baseline if they degrade coverage.

### 5.3 Prefer controlled improvement

- Cache hits may return immediately and refresh in the background.
- Manual refresh should remain available.
- Promotion policy should reward same-or-better coverage, not rigid URL identity.

## 6. UX Rules

### 6.1 The report should be direct

- Keep the report focused on:
  - what the product does
  - the recommendation
  - guardrail findings
  - evidence
  - open questions
  - next steps

### 6.2 Avoid exposing internal mechanics unless asked

- Do not add visible cache-hit, cache-miss, bundle status, or background-refresh labels to the normal UI without a product decision.
- If freshness control is needed, prefer a simple user action such as `Refresh research`.

### 6.3 Keep progress human-readable

- If long-running work is visible, use plain analyst-oriented stages rather than implementation details.

## 7. Git and GitHub Workflow

### 7.1 Sync before starting

Before making substantive changes:

1. check out `main`
2. pull the latest `origin/main`
3. create a fresh working branch from that updated `main`

Do not start new feature work from a stale local branch.

### 7.2 Use branches by default

- Default to a feature branch for non-trivial work.
- Use the `codex/` prefix unless the user explicitly asks otherwise.
- Prefer PR-based changes for code and architectural work.

### 7.3 Commit in logical intervals

- Commit in meaningful, reviewable steps when a change has a coherent checkpoint.
- Good checkpoints include:
  - one stage refactor completed and tested
  - one bug fixed and verified
  - one documentation addition completed
- Do not batch many unrelated changes into one opaque commit when they could be separated.

### 7.4 Keep commits traceable

- Commit messages should clearly describe the logical unit of change.
- Each commit should ideally correspond to one fix, one stage, or one architectural increment.

### 7.5 Rebase mental model: merged means update local main

- After a PR merges, update local `main` before starting the next task.
- Do not assume local `main` reflects GitHub unless it has been fetched and fast-forwarded.

### 7.6 Review comments

- When PR comments arrive, evaluate whether they identify a real issue or just a style preference.
- Fix valid issues.
- Do not implement suggestions blindly if they conflict with actual runtime constraints or structured-output requirements.

## 8. Deployment and Operations

### 8.1 Production instructions must be exact

- When infrastructure changes are introduced, document the exact production steps, not just local behavior.
- If a change requires env vars, migrations, or deploy hooks, document those explicitly.

### 8.2 Migrations are operational requirements

- If storage changes require schema creation, document and enforce the migration path.
- Do not assume startup will create schema automatically unless it truly does.

### 8.3 Prefer production-parallel local setups

- Local development should resemble production where practical.
- If production uses Postgres, prefer local Postgres over inventing a different local-only data path.

## 9. Testing Expectations

- Run the most relevant tests for the change.
- For backend behavioral changes, at minimum prefer:
  - `npm run test:server`
  - `npm run build`
- For workflow changes, also verify the user-facing flow locally when practical.

## 10. Documentation Expectations

- Keep [architecture.md](architecture.md) as the current-state architecture document.
- Keep future-state or target-state design ideas in separate docs rather than overloading the current-state file.
- Use ADR-style documents later for major irreversible decisions if the system grows.
