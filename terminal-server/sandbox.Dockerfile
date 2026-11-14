# LiTTree Terminal V1 — Sandbox Base Image
#
# Contains: bash, pwsh, git, curl, ca-certificates, node, npm, pnpm, python, pip, gh
#
# This image is the controlled environment for all user sandboxes.
# No platform secrets, no daemon processes, no privileged access.

FROM node:22-bookworm-slim

# ─── Base packages ───────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    curl \
    ca-certificates \
    gnupg \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# ─── PowerShell Core ─────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    libicu-dev \
    && curl -fsSL https://github.com/PowerShell/PowerShell/releases/download/v7.4.6/powershell_7.4.6-1.deb_amd64.deb -o /tmp/pwsh.deb \
    && dpkg -i /tmp/pwsh.deb \
    && rm /tmp/pwsh.deb \
    && rm -rf /var/lib/apt/lists/*

# ─── Python ──────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/bin/python

# ─── pnpm ────────────────────────────────────────────────────────
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# ─── GitHub CLI ──────────────────────────────────────────────────
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# ─── Workspace directory ─────────────────────────────────────────
RUN mkdir -p /workspace && chmod 755 /workspace

WORKDIR /workspace

# ─── Sandbox home (Phase 2 lifecycle, design note §4.3) ──────────
# HOME lives OUTSIDE the project tree: /workspace is the synced
# workspace root, and a HOME inside it would copy ~/.npm,
# ~/.gitconfig and ~/.config/gh onto the shared volume on every
# sync-back. /home/litt is never synced (it is outside /workspace).
RUN mkdir -p /home/litt && chmod 777 /home/litt
ENV HOME=/home/litt

# git housekeeping default for workspace repos: never auto-gc, so
# packs are not rewritten between syncs (design note §1.2). Written
# into the sandbox home's gitconfig; repos also get it per-repo at
# clone/mirror time.
RUN git config --global gc.auto 0

# ─── Default shell ───────────────────────────────────────────────
# Bash is the default. PowerShell Core is available as `pwsh`.
ENV SHELL=/bin/bash
ENV TERM=xterm-256color
ENV LANG=en_US.UTF-8

# No CMD — the provider starts the shell via docker exec
CMD ["sleep", "infinity"]
