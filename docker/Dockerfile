# syntax=docker/dockerfile:1
FROM oven/bun:1.4-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/analytics/package.json packages/analytics/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/evals/package.json packages/evals/
COPY packages/github/package.json packages/github/
COPY packages/llm/package.json packages/llm/
COPY packages/queue/package.json packages/queue/
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
RUN bun run --cwd apps/web build

# The root filesystem of each review's sandbox, what Hansi's commands run in: a toolchain most
# repositories can build and test with. Anything else can be installed through the proxy.
FROM node:22-bookworm-slim AS sandbox-rootfs
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		build-essential ca-certificates curl git python3 python3-pip python3-venv \
	&& rm -rf /var/lib/apt/lists/* \
	&& mkdir -p /workspace /run/hansi
COPY docker/sandbox-bridge.mjs /opt/hansi/bridge.mjs

# gVisor's runsc, pinned and checked against its published SHA-512.
FROM debian:bookworm-slim AS gvisor
ARG GVISOR_VERSION=20260928.0
RUN apt-get update && apt-get install -y --no-install-recommends bzip2 ca-certificates curl \
	&& url="https://storage.googleapis.com/gvisor/releases/release/${GVISOR_VERSION}/$(uname -m)" \
	&& cd /tmp && curl -fsSLO "$url/gvisor.tar.bz2" && curl -fsSLO "$url/gvisor.tar.bz2.sha512" \
	&& sha512sum -c gvisor.tar.bz2.sha512 \
	&& mkdir /gvisor && tar -xjf gvisor.tar.bz2 -C /gvisor

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
# Each review's sandbox: gVisor plus its root filesystem (see SANDBOX in .env.example).
COPY --from=gvisor /gvisor/ /usr/local/bin/
COPY --from=sandbox-rootfs / /opt/hansi-sandbox/rootfs/

RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME /data
EXPOSE 3000

# HANS_MODE: all (default, web + worker), web, or worker.
ENTRYPOINT ["tini", "--"]
CMD ["bun", "docker/start.ts"]
