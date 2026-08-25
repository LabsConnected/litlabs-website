FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.mjs ./

# Railway assigns $PORT dynamically — server.mjs reads process.env.PORT
# with fallback to 4002 for local dev. EXPOSE is informational only.
EXPOSE 4002
# Railway injects PORT at runtime; server.mjs reads process.env.PORT first

CMD ["node", "server.mjs"]
