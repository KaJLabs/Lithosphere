FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /var/lib/multx-signer \
    && chown -R node:node /app /var/lib/multx-signer \
    && chmod 0700 /var/lib/multx-signer

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

# The pinned base contains vulnerable OpenSSL and npm CLI packages. npm is build-only.
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && mkdir -p /var/lib/multx-signer \
    && chown node:node /var/lib/multx-signer \
    && chmod 0700 /var/lib/multx-signer
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node

EXPOSE 9443
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "const s=require('net').connect(9443,'127.0.0.1');s.setTimeout(2000);s.on('connect',()=>{s.end();process.exit(0)});s.on('timeout',()=>process.exit(1));s.on('error',()=>process.exit(1))"
CMD ["node", "src/index.js"]
