# n8n — Self-hosted Community Edition for LiTTree Lab Studios
#
# Deploy on Railway:  railway up
# Editor access:      railway run (tunnels to localhost:5678)
# Webhooks:           Forwarded via Next.js /api/n8n/* bridge (authenticated)
#
# This is BEHIND the scenes — never customer-facing.

FROM n8nio/n8n:latest

# n8n runs on port 5678
EXPOSE 5678

# Use the default entrypoint from the official image.
# All configuration is via environment variables (see railway.json + Railway dashboard).
