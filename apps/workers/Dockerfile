FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/workers/package.json apps/workers/
RUN pnpm install --frozen-lockfile --filter @korkep/workers...

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/workers apps/workers
RUN pnpm --filter @korkep/shared build \
  && pnpm --filter @korkep/api build \
  && pnpm --filter @korkep/workers build

FROM deps AS prod-deps
RUN pnpm prune --prod

FROM node:22-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/packages/shared/package.json packages/shared/package.json
COPY --from=prod-deps /app/apps/api/package.json apps/api/package.json
COPY --from=prod-deps /app/apps/workers/package.json apps/workers/package.json
COPY --from=prod-deps /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=prod-deps /app/apps/api/node_modules apps/api/node_modules
COPY --from=prod-deps /app/apps/workers/node_modules apps/workers/node_modules
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/workers/dist apps/workers/dist

WORKDIR /app/apps/workers
CMD ["node", "dist/pipeline/pipeline-job.js"]
