# syntax=docker/dockerfile:1
FROM oven/bun:1.4-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/github/package.json packages/github/
COPY packages/llm/package.json packages/llm/
COPY packages/queue/package.json packages/queue/
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
RUN bun run --cwd apps/web build

FROM base AS runtime
# git clones pull requests; ripgrep powers the agent's search tool.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends git ripgrep ca-certificates tini \
	&& rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
	PORT=3000 \
	DATABASE_URL=file:/data/hans.db \
	WORKER_WORKDIR=/tmp/hans

# Packages run from TypeScript source under Bun; only the web app has a build step.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/worker ./apps/worker
COPY --from=build /app/apps/web/build ./apps/web/build
COPY --from=build /app/apps/web/package.json ./apps/web/
COPY --from=build /app/apps/web/node_modules ./apps/web/node_modules
COPY docker/start.ts ./docker/start.ts

RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME /data
EXPOSE 3000

# HANS_MODE: all (default, web + worker), web, or worker.
ENTRYPOINT ["tini", "--"]
CMD ["bun", "docker/start.ts"]
