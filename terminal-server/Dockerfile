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

# Install dependencies using npm (no workspace root required)
RUN npm install

# Copy terminal server source
COPY . .

# Build the terminal server
RUN npm run build

# Workspace root — Railway persistent volume mount point
ENV TERMINAL_WORKSPACE_ROOT=/data/littree-workspaces
ENV TERMINAL_SERVER_PORT=4001
ENV TERMINAL_USE_DOCKER=false
ENV NODE_ENV=production

# Create the workspace directory
RUN mkdir -p /data/littree-workspaces

EXPOSE 4001

CMD ["node", "dist/server.js"]
