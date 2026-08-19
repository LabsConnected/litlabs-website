# Dockerfile for the music-worker Railway service.
# Tiny image — just Node.js + the worker script. No deps to install.
FROM node:20-slim

WORKDIR /app

COPY package.json worker.js ./

# No healthcheck endpoint — this is a persistent timer, not an HTTP server.
# Railway's restart policy handles failures.
ENV NODE_ENV=production

CMD ["node", "worker.js"]
