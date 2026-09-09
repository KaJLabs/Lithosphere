FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN chown -R node:node /app
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

# Mounted VPS/Docker secrets are loaded before config.js evaluates.
CMD ["node", "src/entrypoint.mjs"]
