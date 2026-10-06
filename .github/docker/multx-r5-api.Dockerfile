FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN install -d -o node -g node /usr/local/lib /usr/local/share \
    && cp review/verify-runtime-source.mjs /usr/local/lib/verify-runtime-source.mjs \
    && cp review/runtime-source-manifest.json /usr/local/share/multx-runtime-source-manifest.json \
    && rm -rf review \
    && chown -R node:node /app /usr/local/lib/verify-runtime-source.mjs /usr/local/share/multx-runtime-source-manifest.json

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

# The pinned base contains vulnerable OpenSSL and npm CLI packages. npm is build-only.
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app
COPY --from=build --chown=node:node /app /app
COPY --from=build /usr/local/lib/verify-runtime-source.mjs /usr/local/lib/verify-runtime-source.mjs
COPY --from=build /usr/local/share/multx-runtime-source-manifest.json /usr/local/share/multx-runtime-source-manifest.json
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1
CMD ["node", "src/entrypoint.mjs"]
