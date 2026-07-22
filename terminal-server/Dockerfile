# Production Dockerfile for the LiTTree terminal server
# Build from the monorepo root:
#   docker build -f terminal-server/Dockerfile -t littree-terminal .
FROM node:22-slim

# Install dependencies for node-pty and shell tools
RUN apt-get update && apt-get install -y \
    python3 make g++ bash git curl \
    && rm -rf /var/lib/apt/lists/*

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# Copy monorepo workspace files for pnpm
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/litt-agent-core/package.json packages/litt-agent-core/
COPY terminal-server/package.json terminal-server/tsconfig.json terminal-server/

# Install dependencies (only the workspace packages we need)
RUN pnpm install --frozen-lockfile --filter terminal-server --filter "@litt/agent-core"

# Build @litt/agent-core first
RUN pnpm --filter @litt/agent-core build

# Copy terminal server source
COPY terminal-server/ terminal-server/

# Build the terminal server
RUN pnpm --filter terminal-server build

# Workspace root for cloned repos
ENV TERMINAL_WORKSPACE_ROOT=/data/workspaces
ENV TERMINAL_SERVER_PORT=4001
ENV TERMINAL_USE_DOCKER=false

EXPOSE 4001

WORKDIR /app/terminal-server
CMD ["node", "dist/server.js"]
