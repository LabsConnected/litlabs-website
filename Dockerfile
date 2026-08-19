# Dockerfile for the LiTLabs Next.js web app (litlabs.net)
# Multi-stage build using Next.js standalone output mode.
# Deployed to Railway as the "web" service.
#
# Build context: repo root (monorepo)
# Entry point: .next/standalone/server.js (Next.js standalone server)
#
# Architecture:
#   Stage 1 (deps)    — install all workspace dependencies
#   Stage 2 (builder) — build workspace packages + Next.js app
#   Stage 3 (runner)  — minimal runtime image with standalone output

# ─── Stage 1: Dependencies ─────────────────────────────────────────
FROM node:22-slim AS deps

# Install build tools for native modules (sharp, etc.)
RUN apt-get update && apt-get install -y \
    python3 make g++ \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Enable pnpm via corepack (matches packageManager: pnpm@9.15.0)
RUN corepack enable pnpm

# Copy workspace config + all package.json files for dependency caching.
# This layer is cached unless a package.json or lockfile changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY package.json ./
COPY packages/litt-agent-core/package.json ./packages/litt-agent-core/
COPY packages/litt-cli/package.json ./packages/litt-cli/
COPY packages/litt-models/package.json ./packages/litt-models/
COPY packages/litt-shell/package.json ./packages/litt-shell/
COPY packages/litt-companion/package.json ./packages/litt-companion/
COPY terminal-server/package.json ./terminal-server/
COPY voice-server/package.json ./voice-server/
COPY cli/package.json ./cli/

# Install all workspace dependencies.
# ignore-scripts=true is set in .npmrc — sharp uses prebuilt binaries
# via optional deps (@img/sharp-*), so native scripts aren't needed.
RUN pnpm install --frozen-lockfile

# ─── Stage 2: Builder ──────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

RUN corepack enable pnpm

# Copy installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/litt-agent-core/node_modules ./packages/litt-agent-core/node_modules

# Copy source code
COPY . .

# Build workspace packages that the web app depends on.
# @litt/agent-core is imported in production code (useLiTTRuntime.ts,
# LandingMissionProof.tsx) and must be compiled before next build.
RUN pnpm --filter @litt/agent-core build

# Build the Next.js app (produces .next/standalone/)
# Next.js standalone output copies only the needed node_modules into
# .next/standalone/node_modules — the runtime image won't need the full
# node_modules tree.
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ─── Stage 3: Runtime ──────────────────────────────────────────────
FROM node:22-slim AS runner

# Install libvips for sharp image optimization at runtime.
# The standalone output includes sharp's JS + prebuilt binary, but the
# system library is needed for the binary to link against.
RUN apt-get update && apt-get install -y \
    libvips \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Railway assigns $PORT dynamically — Next.js standalone reads this.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Copy the standalone server (includes minimal node_modules)
COPY --from=builder /app/.next/standalone ./
# Copy static assets (not included in standalone by default)
COPY --from=builder /app/.next/static ./.next/static
# Copy public assets (images, emulatorjs, fonts, etc.)
COPY --from=builder /app/public ./public

# Railway uses $PORT — Next.js standalone server.js respects it.
EXPOSE $PORT

CMD ["node", "server.js"]
