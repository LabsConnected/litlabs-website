# Production Dockerfile for the LiTTree terminal server
FROM node:22-slim

# Install dependencies for node-pty and optional shell tools
RUN apt-get update && apt-get install -y \
    python3 make g++ bash git curl ca-certificates gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI (gh)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
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

# Workspace root
ENV TERMINAL_WORKSPACE_ROOT=/tmp/littree-workspaces
ENV TERMINAL_SERVER_PORT=4001
ENV TERMINAL_USE_DOCKER=false

EXPOSE 4001

CMD ["node", "dist/server.js"]
