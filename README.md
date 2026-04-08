# ArchReviewAgent

A React and Node application for procurement-style vendor research. The UI accepts a company or product name, and the backend uses the OpenAI Agents SDK plus hosted web search to evaluate enterprise readiness with emphasis on:

- EU data residency
- enterprise deployment options

The live research workflow is designed around a security-analyst persona and includes:

- streamed progress updates during long-running research
- typo and ambiguity handling for vendor names
- input validation against prompt-like or malformed vendor requests
- official-domain filtering so live evidence stays tied to the resolved vendor
- a fast test mode for UI verification without live web research

## Stack

- React + Vite frontend
- Express backend
- OpenAI Agents SDK (`@openai/agents`)
- TypeScript + Zod

## Prerequisites

- Node.js 22+ is the supported runtime for the current OpenAI Agents SDK
- an `OPENAI_API_KEY`
- Postgres if you want server-side research caching

## Setup

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

To run Postgres locally with Docker:

```bash
docker compose -f docker-compose.postgres.yml up -d
```

The default `.env.example` is already configured for that local container:

- `DATABASE_URL=postgres://archagent:archagent@localhost:55432/archagent`
- the local Docker helper binds Postgres on `localhost:55432` to avoid common port conflicts
- loopback browser origins such as `http://localhost:5173` are allowed automatically outside production
- `INTERNAL_API_TOKEN` is optional; when set in production it unlocks internal-only endpoints like `/api/internal/health` with the `x-internal-api-token` header

For production, set `ALLOWED_ORIGINS` to the exact browser origin or origins that should be able to call the API, for example:

- `ALLOWED_ORIGINS=https://your-app.example.com`

Frontend: `http://localhost:5173`

Backend: `http://localhost:8787`

For a fast mocked run without live web research, open:

- `http://localhost:5173/?mode=test`

For the live backend health check:

- `http://localhost:8787/api/health`

For detailed health output during local debugging:

- `http://localhost:8787/api/internal/health`

## Production build

```bash
npm run build
npm run start
```

The backend serves the built frontend from `dist/` in production mode.

## Architecture documents

- current production architecture: [architecture.md](architecture.md)
- future extensibility design for configurable guardrails: [docs/extensible-guardrail-architecture.md](docs/extensible-guardrail-architecture.md)
- evaluation strategy for releases and production: [docs/evaluation-plan.md](docs/evaluation-plan.md)
- eval case schema and validator: [evals/caseSchema.ts](evals/caseSchema.ts), [evals/validateCases.ts](evals/validateCases.ts)

## Database migrations

```bash
npm run db:migrate
```

If `DATABASE_URL` is configured, the backend will:

- cache resolved vendor identities
- cache accepted research reports and their evidence metadata
- persist per-run trace artifacts for offline shadow grading
- reuse fresh accepted reports on repeated lookups for more stable results
- trigger one background refresh on cache hits, then compare the refreshed candidate against the accepted baseline before promotion

To inspect stored research traces locally:

```bash
npm run traces:inspect -- --limit 5
npm run traces:inspect -- --run-id <run_id>
```

In production:

- `/api/health` returns only a minimal liveness response
- `/api/chat/test` is not exposed publicly
- `/api/internal/health` requires the `x-internal-api-token` header if `INTERNAL_API_TOKEN` is configured
