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

Frontend: `http://localhost:5173`

Backend: `http://localhost:8787`

For a fast mocked run without live web research, open:

- `http://localhost:5173/?mode=test`

For the live backend health check:

- `http://localhost:8787/api/health`

## Production build

```bash
npm run build
npm run start
```

The backend serves the built frontend from `dist/` in production mode.

## Architecture documents

- current production architecture: [architecture.md](architecture.md)
- future extensibility design for configurable guardrails: [docs/extensible-guardrail-architecture.md](docs/extensible-guardrail-architecture.md)

## Database migrations

```bash
npm run db:migrate
```

If `DATABASE_URL` is configured, the backend will:

- cache resolved vendor identities
- cache accepted research reports and their evidence metadata
- reuse fresh accepted reports on repeated lookups for more stable results
- trigger one background refresh on cache hits, then compare the refreshed candidate against the accepted baseline before promotion
