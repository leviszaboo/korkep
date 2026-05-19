FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/workers/package.json apps/workers/
RUN pnpm install --frozen-lockfile --filter @korkep/workers...

FROM base AS build
COPY --from=deps /app /app
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/workers apps/workers
RUN pnpm --filter @korkep/shared build && pnpm --filter @korkep/api build && pnpm --filter @korkep/workers build

FROM base AS runner
COPY --from=deps /app /app
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/workers/dist apps/workers/dist

WORKDIR /app/apps/workers
CMD ["node", "dist/pipeline/scrape-job.js"]
