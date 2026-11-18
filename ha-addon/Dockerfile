# syntax=docker/dockerfile:1
# LiTTree Lab Studios — Home Assistant Add-on
# Multi-stage build: Node.js build → Nginx serve

# Stage 1: Build the Next.js app
FROM node:22-alpine AS builder
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --prefer-offline --no-audit

# Copy source and build
COPY . .
RUN npm run build

# Stage 2: Serve with Nginx (ingress-aware)
FROM nginx:alpine
RUN apk add --no-cache jq

# Nginx config for HA ingress
COPY ha-addon/nginx.conf /etc/nginx/nginx.conf
COPY ha-addon/run.sh /run.sh
RUN chmod +x /run.sh

# Copy built app from builder
COPY --from=builder /app/.next/standalone /usr/share/nginx/html/
COPY --from=builder /app/public /usr/share/nginx/html/public
COPY --from=builder /app/.next/static /usr/share/nginx/html/.next/static

EXPOSE 3000

ENTRYPOINT ["/run.sh"]
