FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @korkep/web... --filter @korkep/shared...

FROM base AS build
COPY --from=deps /app /app
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @korkep/shared build && pnpm --filter @korkep/web build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static apps/web/.next/static

WORKDIR /app/apps/web
EXPOSE 3000
CMD ["node", "server.js"]
