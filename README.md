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

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

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
