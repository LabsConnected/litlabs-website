FROM node:22-slim

WORKDIR /app

COPY package.json ./
COPY server.mjs ./

EXPOSE 4010
# Railway injects PORT at runtime; server.mjs reads process.env.PORT first

CMD ["node", "server.mjs"]
