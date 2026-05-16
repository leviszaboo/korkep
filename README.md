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
│  Scheduler ──▶ RSS Adapters ──▶ BullMQ ──▶ Process Worker          │
│                  (10 sources)       │                              │
│                                     ├──▶ LLM Analyzer (OpenRouter) │
│                                     ├──▶ Embedder (OpenRouter)     │
│                                     └──▶ Clusterer (HDBSCAN)       │
│                                                                    │
│  Periodic: HDBSCAN recluster with LLM-generated story titles       │
└────────────────────────────────────────────────────────────────────┘
```

### Services

| Service | Description | Tech |
|---------|-------------|------|
| **api** | REST API — stories, sources, full-text search | Fastify, Drizzle ORM |
| **scraper** | RSS polling, content extraction, NLP analysis, embedding, clustering | BullMQ workers, Cheerio |
| **clusterer** | HDBSCAN clustering microservice | Python, FastAPI, hdbscan |
| **web** | Server-rendered frontend | Next.js 16, Tailwind CSS 4 |
| **postgres** | Primary data store with pgvector for similarity search | PostgreSQL 16 + pgvector |
| **redis** | Job queue backend and caching | Redis 7 Alpine |

### Processing Pipeline

1. **Scrape** — RSS adapters poll 10 Hungarian outlets every 10–20 minutes
2. **Extract** — Cheerio parses article body, lead paragraph, category, author, image
3. **Analyze** — LLM (Gemini Flash via OpenRouter) extracts structured fields: summary, headline, main event, location, entities, topics
4. **Embed** — OpenRouter embedding API (Qwen3 8B, 1024-dim) generates semantic vectors
5. **Cluster** — Cosine similarity against recent articles assigns each to a story cluster
6. **Recluster** — Every hour, HDBSCAN re-clusters all articles from the last 72h and generates neutral story titles and summaries via LLM

### Database Schema

- **sources** — News outlet configuration (name, URL, RSS feed, bias rating)
- **articles** — Scraped articles with body, lead, summary, structured NLP fields, embedding vector, fingerprint
- **stories** — Clusters of articles about the same event, with relevance scoring, topics, and LLM-generated summaries

Full-text search uses PostgreSQL `tsvector` with a trigger that indexes article titles and bodies.

## Quick Start

### Prerequisites

- Docker & Docker Compose
- OpenRouter API key (for embeddings and LLM analysis)
- Node.js 22+ and pnpm 10+ (for local dev only)

### Run with Docker

```bash
# Copy environment config
cp .env.example .env
# Edit .env and add your OPENROUTER_API_KEY

# Build and start all services
docker compose up -d --build

# Run database migrations
docker compose --profile setup run --rm migrate

# Seed news sources
docker compose exec api node -e "
  // or run locally:
  // pnpm --filter @korkep/api seed
"

# View logs
docker compose logs -f
```

Services will be available at:

| Service | URL |
|---------|-----|
| Web | http://localhost:3000 |
| API | http://localhost:3001 |
| Clusterer | http://localhost:8101 |
| Postgres | localhost:5432 |
| Redis | localhost:6379 |

### Local Development

```bash
# Install dependencies
pnpm install

# Start infrastructure (postgres, redis, clusterer)
docker compose up -d postgres redis clusterer

# Run migrations
DATABASE_URL=postgres://korkep:korkep@localhost:5432/korkep \
  pnpm --filter @korkep/api migrate

# Seed sources
pnpm --filter @korkep/api seed

# Start all apps in dev mode
pnpm dev
```

## Docker Compose Profiles

Beyond the default services, docker-compose.yml includes several one-shot profiles:

### Recluster (rebuild story clusters)

Re-runs HDBSCAN clustering on all articles from the last 72 hours. Deletes existing stories and creates new clusters with LLM-generated titles and summaries. Reuses cached titles for unchanged clusters. Useful after tuning clustering parameters or fixing bad clusters.

```bash
docker compose up -d postgres clusterer
docker compose --profile recluster run --rm recluster
```

### Re-embed (regenerate all embeddings + recluster)

Wipes all embeddings and story assignments, then re-analyzes and re-embeds every article before re-clustering from scratch. Use after changing the embedding model or dimensions.

```bash
docker compose up -d postgres
docker compose --profile reembed run --rm reembed
```

### Resummarize (regenerate LLM analysis)

Re-runs LLM analysis (summary, headline, entities, topics) on recent articles and regenerates story titles/summaries for affected stories. Defaults to last 24 hours; configure with `SINCE_HOURS`.

```bash
docker compose up -d postgres
SINCE_HOURS=48 docker compose --profile resummarize run --rm resummarize
```

### Diagnostics

Prints cluster statistics: article/story counts, embedding coverage, similarity distributions, and largest stories.

```bash
docker compose up -d postgres
docker compose --profile recluster run --rm diagnostics
```

### Migrate

Runs database migrations.

```bash
docker compose --profile setup run --rm migrate
```

## Test Data

The `data/seed.json` file contains a snapshot of sources, stories, and articles exported from a live instance. It includes:

- All 10 configured news sources with bias ratings
- Multi-source stories (articles covered by 2+ outlets)
- Articles with titles, truncated bodies, fingerprints, and story assignments

This can be used to bootstrap a development database without waiting for the scraper to collect articles.

## Environment Variables

Copy `.env.example` to `.env`:

```
DATABASE_URL=postgres://korkep:korkep@localhost:5432/korkep
REDIS_URL=redis://localhost:6379
OPENROUTER_API_KEY=sk-or-...
SUMMARIZER_MODEL=google/gemini-2.0-flash-001
```

| Variable | Service | Default |
|----------|---------|---------|
| `DATABASE_URL` | api, scraper, migrate | `postgres://korkep:korkep@localhost:5432/korkep` |
| `REDIS_URL` | scraper | `redis://localhost:6379` |
| `OPENROUTER_API_KEY` | scraper | — (required) |
| `EMBEDDING_MODEL` | scraper | `qwen/qwen3-embedding-8b` |
| `EMBEDDING_DIMENSIONS` | scraper | `1024` |
| `SUMMARIZER_MODEL` | scraper | `google/gemini-2.0-flash-001` |
| `CLUSTERER_URL` | scraper | `http://localhost:8101` |
| `HOST` | api | `0.0.0.0` |
| `PORT` | api | `3001` |
| `CORS_ORIGIN` | api | `http://localhost:3000` |
| `API_URL` | web | `http://localhost:3001` |

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
│   ├── scraper/        BullMQ workers — scraping, NLP analysis, embedding, clustering
│   ├── clusterer/      Python HDBSCAN clustering microservice
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

| Source | Bias | Method | Interval |
|--------|------|--------|----------|
| Telex | center | RSS | 10 min |
| 444.hu | left | RSS | 10 min |
| HVG | center-left | RSS | 15 min |
| Index.hu | center | RSS | 15 min |
| Magyar Nemzet | right | RSS | 15 min |
| Origo | right | RSS | 15 min |
| 24.hu | center-left | RSS | 15 min |
| Mandiner | right | RSS | 15 min |
| Blikk | center | RSS | 15 min |
| Magyar Hang | center-right | RSS | 20 min |
