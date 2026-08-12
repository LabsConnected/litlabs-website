# Production Dockerfile for the LiTTree terminal server
# Build context: terminal-server/ (Railway root directory set to "terminal-server")
# To build locally: docker build -f Dockerfile . from terminal-server/ directory
FROM node:20-slim

# Install dependencies for node-pty and optional shell tools
RUN apt-get update && apt-get install -y \
    python3 make g++ bash git curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy terminal server package files
COPY package.json ./
COPY tsconfig.json ./
COPY tsconfig.worker.json ./

# Install dependencies — --ignore-scripts=false ensures node-pty native build runs
# (root .npmrc has ignore-scripts=true; this override is scoped to Docker build only)
RUN npm install --ignore-scripts=false

# Copy terminal server source
COPY . .

# Build the terminal server
RUN npm run build

# Workspace root — Railway persistent volume mount point
ENV TERMINAL_WORKSPACE_ROOT=/data/littree-workspaces
ENV NODE_ENV=production
# PORT is provided by Railway at runtime; terminal server reads process.env.PORT

# Create the workspace directory
RUN mkdir -p /data/littree-workspaces

# Railway assigns $PORT dynamically — don't hardcode 4001
EXPOSE ${PORT:-4001}

CMD ["node", "dist/server.js"]
