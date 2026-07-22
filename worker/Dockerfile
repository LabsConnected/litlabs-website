# Production Dockerfile for the LiTTree agent worker daemon
# Build from the monorepo root:
#   docker build -f worker/Dockerfile -t littree-worker .
FROM node:22-slim

RUN apt-get update && apt-get install -y \
    python3 make g++ bash git curl unzip \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# Copy monorepo workspace files
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/litt-agent-core/package.json packages/litt-agent-core/

# Install all root dependencies + agent-core
RUN pnpm install --frozen-lockfile --filter "@litt/agent-core" && pnpm install --frozen-lockfile

# Copy and build agent-core
COPY packages/litt-agent-core/ packages/litt-agent-core/
RUN pnpm --filter @litt/agent-core build

# Copy the daemon entry point
COPY worker/entry.ts worker/entry.ts

# Copy full src/ for path alias resolution
COPY src/ src/

# Copy tsconfig.json for @/* path alias resolution
COPY worker/tsconfig.json tsconfig.json

# Fix import path: entry.ts uses ../src/lib/agent-worker (relative to worker/)
# which resolves correctly in Docker context

# Install tsx for running TypeScript
RUN pnpm add -w tsx@latest

ENV TARGET_AGENT_SLUG=director
ENV MAX_CONCURRENCY=3
ENV POLL_INTERVAL_MS=5000
ENV NODE_ENV=production

WORKDIR /app
CMD ["npx", "tsx", "worker/entry.ts"]
