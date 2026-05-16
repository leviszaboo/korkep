FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/scraper/package.json apps/scraper/
RUN pnpm install --frozen-lockfile --filter @korkep/scraper...

FROM base AS build
COPY --from=deps /app /app
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/scraper apps/scraper
RUN pnpm --filter @korkep/shared build && pnpm --filter @korkep/api build && pnpm --filter @korkep/scraper build

FROM base AS runner
COPY --from=deps /app /app
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/scraper/dist apps/scraper/dist

WORKDIR /app/apps/scraper
CMD ["node", "dist/index.js"]
