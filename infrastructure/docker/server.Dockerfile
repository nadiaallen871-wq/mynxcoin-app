# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace server --include-workspace-root=false --omit=dev --ignore-scripts

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app/server
RUN apk add --no-cache openssl && addgroup -S mynx && adduser -S mynx -G mynx
COPY --from=deps /app/node_modules /app/node_modules
COPY server/ ./
# Private document storage must be writable by the unprivileged user. In production mount a
# persistent, encrypted volume here (or switch STORAGE_DRIVER to object storage).
RUN npx prisma generate   && mkdir -p /app/server/storage/private && chown -R mynx:mynx /app/server/storage
VOLUME ["/app/server/storage"]
USER mynx
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 CMD wget -qO- http://127.0.0.1:4000/api/v1/health || exit 1
CMD ["node", "src/server.js"]
