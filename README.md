# Körkép

Hungarian news aggregator that scrapes articles from multiple outlets, clusters them into stories using embeddings and HDBSCAN, generates neutral summaries via LLM, and displays multi-source coverage with political bias indicators.

**Körkép** (Hungarian for "panorama") lets you see how different news sources cover the same event — side by side, across the political spectrum.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          CLIENTS                                 │
│                    Next.js SSR Web App                           │
└─────────────────────────┬────────────────────────────────────────┘
                          │
                    ┌─────▼─────┐
                    │  Fastify  │  REST API (stories, sources, search)
                    │    API    │  Port 3001
                    └─────┬─────┘
                          │
┌─────────────────────────▼────────────────────────────────────────┐
│                       DATA LAYER                                 │
│         PostgreSQL 16 (pgvector) + Redis 7                       │
└─────────────────────────▲────────────────────────────────────────┘
                          │
┌─────────────────────────┴──────────────────────────────────────────┐
│                   INGESTION PIPELINE                               │
│                                                                    │
│  Scrape Job ──▶ Source Adapters ──▶ Redis Queues ──▶ Process Job   │
│                                                        │           │
│                                                        ├──▶ LLM    │
│                                                        ├──▶ Embed  │
│                                                        └──▶ Story  │
│                                                            Assign  │
│                                                                    │
│  Periodic: batch HDBSCAN recluster with LLM story summaries        │
└────────────────────────────────────────────────────────────────────┘
```

### Services

| Service | Description | Tech |
|---------|-------------|------|
| **api** | REST API — stories, sources, full-text search | Fastify, Drizzle ORM |
| **pipeline** | Compose service that runs the scrape pipeline from the workers image | TypeScript, Redis queues, Cheerio |
| **workers** | Worker package containing scrape, process, embed-cluster, repair, and maintenance jobs | TypeScript, Redis queues, Cheerio |
| **batch-clusterer** | HDBSCAN clustering microservice for full reclusters | Python, FastAPI, hdbscan |
| **web** | Server-rendered frontend | Next.js 16, Tailwind CSS 4 |
| **postgres** | Primary data store with pgvector for similarity search | PostgreSQL 16 + pgvector |
| **redis** | Job queue backend and caching | Redis 7 Alpine |

### Processing Pipeline

1. **Scrape** — source adapters fetch configured Hungarian outlets and enqueue new articles
2. **Extract** — Cheerio parses article body, lead paragraph, category, author, image
3. **Analyze** — LLM provider (`gemini-fallback` by default, or OpenRouter) extracts structured fields: summary, main event, story identity, location, entities, topics
4. **Embed** — OpenRouter embedding API (Qwen3 8B, 1024-dim) generates semantic vectors
5. **Assign** — weighted semantic/entity/token similarity against recent articles assigns each article to a story
6. **Recluster** — HDBSCAN batch jobs can re-cluster recent articles and generate neutral story titles and summaries via LLM

### Database Schema

- **sources** — News outlet configuration (name, URL, RSS feed, bias rating)
- **articles** — Scraped articles with body, lead, summary, structured NLP fields, embedding vector, fingerprint
- **stories** — Clusters of articles about the same event, with relevance scoring, topics, and LLM-generated summaries

Full-text search uses PostgreSQL `tsvector` with a trigger that indexes article titles and bodies.

## Quick Start

### Prerequisites

- Docker & Docker Compose
- OpenRouter API key (required for embeddings; also used for OpenRouter LLM mode)
- Google AI Studio API key (optional, used by the default Gemini fallback LLM mode)
- Node.js 22+ and pnpm 10+ (for local dev only)

### Run with Docker

```bash
# Copy environment config
cp .env.example .env
# Edit .env and add your OPENROUTER_API_KEY

# Build and start infrastructure first
docker compose up -d --build postgres redis batch-clusterer

# Run database migrations
docker compose --profile setup run --rm migrate

# Start the app and scrape pipeline
docker compose up -d --build api web pipeline

# View logs
docker compose logs -f
```

Services will be available at:

| Service | URL |
|---------|-----|
| Web | http://localhost:3000 |
| API | http://localhost:3001 |
| Batch Clusterer | http://localhost:8101 |
| Postgres | localhost:5432 |
| Redis | localhost:6379 |

### Deploy To Cloud Run

Cloud deployment is configured from `deploy/env.production`. This file is gitignored because it contains project-specific settings and secrets. Start from the template:

```bash
cp deploy/env.production.example deploy/env.production
```

Edit `deploy/env.production` and set:

- `GCP_PROJECT_ID` and `GCP_REGION`
- `DATABASE_URL` for Neon Postgres
- `REDIS_URL` for Upstash Redis
- `OPENROUTER_API_KEY`
- optional `GOOGLE_AI_STUDIO_API_KEY`
- Cloud Run sizing, schedules, rate limits, and LLM concurrency values

Bootstrap the Google Cloud project and store secrets:

```bash
./deploy/setup.sh
```

Deploy everything:

```bash
./deploy/deploy.sh full
```

Run the interactive deploy helper:

```bash
./deploy/deploy.sh
```

Deploy or reconfigure one target:

```bash
./deploy/deploy.sh deploy api
./deploy/deploy.sh deploy process
./deploy/deploy.sh config repair
```

Use a named env profile:

```bash
./deploy/deploy.sh --env production deploy api
./deploy/deploy.sh --env staging full
```

Rotate a GCP Secret Manager value:

```bash
./deploy/deploy.sh secret openrouter-api-key
```

Trigger a Cloud Run job manually:

```bash
./deploy/deploy.sh trigger scrape
./deploy/deploy.sh trigger repair REPAIR_MAX_ARTICLES=25 REPAIR_MAX_STORIES=10
```

Run diagnostics for resource sizing, free-tier projections, and Postgres/LLM usage:

```bash
./deploy/deploy.sh diagnostics
```

### Scheduled Diagnostics Via GitHub Actions

The `Collect diagnostics` workflow runs hourly and writes diagnostics into the `diagnostics` schema of the configured Neon Postgres database. This avoids Cloud Scheduler and does not require a public VM or service endpoint. LLM usage stays in the existing `llm_usage_log` table; the workflow does not duplicate it into diagnostics tables.

Create these GitHub Actions secrets:

- `DATABASE_URL`
- `GCP_PROJECT_ID`
- `GCP_REGION`
- `GCP_SERVICE_ACCOUNT_KEY`
- `NEON_API_KEY`
- `NEON_PROJECT_ID`

Optional secrets:

- `NEON_ORG_ID`
- `NEON_PROJECT_IDS`
- `NEON_BRANCH_IDS`

Optional repository variable:

- `CLOUD_RUN_LOG_LIMIT`, default `20000`

The GCP service account in `GCP_SERVICE_ACCOUNT_KEY` needs read access for Cloud Run and Cloud Logging, for example `roles/run.viewer` and `roles/logging.viewer`.

Run manually:

```bash
gh workflow run diagnostics.yml -f lookback_hours=24
```

### Local Development

```bash
# Install dependencies
pnpm install

# Start infrastructure (postgres, redis, batch-clusterer)
docker compose up -d postgres redis batch-clusterer

# Run migrations
DATABASE_URL=postgres://korkep:korkep@localhost:5432/korkep \
  pnpm --filter @korkep/api migrate

# Start all apps in dev mode
pnpm dev
```

## Docker Compose Jobs

Beyond the default services, `docker-compose.yml` includes several one-shot profile jobs. The repair path is a local worker command, matching the production repair entrypoint.

### Recluster (rebuild story clusters)

Re-runs HDBSCAN clustering on all articles from the last 72 hours. Deletes existing stories and creates new clusters with LLM-generated titles and summaries. Reuses cached titles for unchanged clusters. Useful after tuning clustering parameters or fixing bad clusters.

```bash
docker compose up -d postgres batch-clusterer
docker compose --profile recluster run --rm recluster
```

### Re-embed (regenerate all embeddings + recluster)

Wipes all embeddings and story assignments, then re-analyzes and re-embeds every article before re-clustering from scratch. Use after changing the embedding model or dimensions.

```bash
docker compose up -d postgres
docker compose --profile reembed run --rm reembed
```

### Strict story identity re-embedding

After changing clustering text, re-embed recent articles before judging cluster quality:

```bash
SINCE_HOURS=16 docker compose --profile reembed run --rm reembed
docker compose run --rm pipeline node dist/processors/recluster.js
```

Start with 16 hours. Compare known regression clusters before widening the window.

### Resummarize (regenerate LLM analysis)

Re-runs LLM analysis (summary, headline, entities, topics) on recent articles and regenerates story titles/summaries for affected stories. Defaults to last 24 hours; configure with `SINCE_HOURS`.

```bash
docker compose up -d postgres
SINCE_HOURS=48 docker compose --profile resummarize run --rm resummarize
```

### Repair (fix missing article/story summaries and embeddings)

Runs the production repair path locally. The job checks recent articles for missing summaries or embeddings, and recent stories for missing summaries. Work is capped so a large backlog drains across multiple runs instead of timing out.
Records newer than the grace window are skipped so repair does not duplicate the normal scrape/process/embed pipeline.

```bash
docker compose up -d postgres
REPAIR_MAX_ARTICLES=25 REPAIR_MAX_STORIES=10 pnpm --filter @korkep/workers exec tsx src/repair.ts
```

Production defaults:

- `REPAIR_LOOKBACK_HOURS=24`
- `REPAIR_GRACE_MINUTES=90`
- `REPAIR_MAX_ARTICLES=100`
- `REPAIR_MAX_STORIES=50`
- `REPAIR_ANALYSIS_CONCURRENCY=1`
- `REPAIR_EMBEDDING_BATCH_SIZE=50`


### Migrate

Runs database migrations.

```bash
docker compose --profile setup run --rm migrate
```

## Test Data

The `data/seed.json` file contains a snapshot of sources, stories, and articles exported from a live instance. It includes:

- Configured news sources with bias ratings
- Multi-source stories (articles covered by 2+ outlets)
- Articles with titles, truncated bodies, fingerprints, and story assignments

This can be used to bootstrap a development database without waiting for the scrape job to collect articles.

## Environment Variables

Copy `.env.example` to `.env`:

```
DATABASE_URL=postgres://korkep:korkep@localhost:5432/korkep
REDIS_URL=redis://localhost:6379
OPENROUTER_API_KEY=sk-or-...
GOOGLE_AI_STUDIO_API_KEY=
LLM_PROVIDER=gemini-fallback
LLM_MODEL=google/gemma-4-26b-a4b-it
EMBEDDING_MODEL=qwen/qwen3-embedding-8b
BATCH_CLUSTERER_URL=http://localhost:8101
```

| Variable | Service | Default |
|----------|---------|---------|
| `DATABASE_URL` | api, workers, migrate | `postgres://korkep:korkep@localhost:5432/korkep` |
| `REDIS_URL` | workers | `redis://localhost:6379` |
| `OPENROUTER_API_KEY` | workers | — (required for embeddings/OpenRouter) |
| `GOOGLE_AI_STUDIO_API_KEY` | workers | — (optional for `gemini-fallback`) |
| `LLM_PROVIDER` | workers | `gemini-fallback` |
| `LLM_MODEL` | workers | `google/gemma-4-26b-a4b-it` |
| `LLM_CONCURRENCY` | workers | `1` (`5` in the Docker pipeline service) |
| `EMBEDDING_MODEL` | workers | `qwen/qwen3-embedding-8b` |
| `EMBEDDING_DIMENSIONS` | workers | `1024` |
| `EMBEDDING_CONCURRENCY` | workers | `10` (`15` in the Docker pipeline service) |
| `BATCH_CLUSTERER_URL` | workers | `http://localhost:8101` |
| `RECLUSTER_LLM_PROVIDER` | workers | `gemini-fallback` (`openrouter` in the Docker recluster profile) |
| `RECLUSTER_LLM_MODEL` | workers | `google/gemma-4-31b-it` |
| `HOST` | api | `0.0.0.0` |
| `PORT` | api | `3001` |
| `CORS_ORIGIN` | api | `http://localhost:3000` |
| `RATE_LIMIT_ENABLED` | api | `1` |
| `RATE_LIMIT_MAX` | api | `120` |
| `SEARCH_RATE_LIMIT_MAX` | api | `30` |
| `RATE_LIMIT_WINDOW_SECONDS` | api | `60` |
| `API_URL` | web | `http://localhost:3001` |
| `NEXT_PUBLIC_API_URL` | web client components | `http://localhost:3001` |

## Scripts

```bash
pnpm build              # Build all packages
pnpm dev                # Start all apps in dev mode
pnpm typecheck          # Type-check all packages
pnpm docker:up          # docker compose up -d --build
pnpm docker:down        # docker compose down
pnpm docker:migrate     # Run migrations in Docker
pnpm test:integration   # Run integration tests
```

## Project Structure

```
korkep/
├── apps/
│   ├── api/            Fastify REST API (stories, sources, search)
│   ├── workers/        Worker jobs — scraping, NLP analysis, embedding, clustering
│   ├── batch-clusterer/  Python HDBSCAN clustering microservice
│   └── web/            Next.js 16 frontend with Tailwind CSS
├── packages/
│   └── shared/         Types, constants, utilities shared across apps
├── data/
│   └── seed.json       Sample data export for development
└── tests/
    ├── integration.sh  Integration test suite
    └── check-selectors.ts  RSS/HTML selector verification for adapters
```

## News Sources

The database is seeded from migrations with these sources. The scrape job registry wires all listed sources; MTI uses a homepage adapter because it does not expose an RSS feed in the shared source metadata.

All adapter-backed sources are scraped on each scheduled scrape run. In production, Cloud Scheduler triggers the scrape job every 15 minutes during the day and hourly overnight by default; the job then fetches all configured sources with source-level concurrency.

| Source | Bias | Method |
|--------|------|--------|
| Telex | left | RSS |
| 444.hu | left | RSS |
| HVG | left | RSS |
| Index.hu | center-right | RSS |
| Magyar Nemzet | right | RSS |
| Origo | right | RSS |
| 24.hu | center-left | RSS |
| Mandiner | right | RSS |
| Blikk | center | RSS |
| Magyar Hang | center | RSS |
| Euronews Hungary | center | RSS |
| Metropol | right | RSS |
| Ripost | right | RSS |
| ATV | center-left | RSS |
| Portfolio | center | RSS |
| Világgazdaság | right | RSS |
| Infostart | center | RSS |
| Pesti Srácok | right | RSS |
| MTI | center-left | homepage adapter |
| Kontroll | center-left | RSS |
| Demokrata | right | RSS |
