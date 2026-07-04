# Production Dockerfile for the LiTTree terminal server
FROM node:20-slim

# Install dependencies for node-pty and optional shell tools
RUN apt-get update && apt-get install -y \
    python3 make g++ bash git curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy root package files (terminal server uses workspace dependencies)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY terminal-server/package.json ./terminal-server/
COPY terminal-server/tsconfig.json ./terminal-server/

# Install pnpm
RUN npm install -g pnpm

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy terminal server source
COPY terminal-server ./terminal-server

# Build the terminal server
RUN pnpm --filter terminal-server build

# Workspace root
ENV TERMINAL_WORKSPACE_ROOT=/tmp/littree-workspaces
ENV TERMINAL_SERVER_PORT=4001
ENV TERMINAL_USE_DOCKER=false

EXPOSE 4001

CMD ["node", "terminal-server/dist/server.js"]
