# ==============================================================================
# WSM SportsERP — Multi-Stage Production & Staging Dockerfile
# ==============================================================================

# Stage 1: Build Workspace & Artifacts
FROM node:24-alpine AS builder

WORKDIR /app

# Copy root & workspace package descriptors for optimal layer caching
COPY package*.json ./
COPY packages/common/package*.json ./packages/common/
COPY packages/client/package*.json ./packages/client/
COPY packages/server/package*.json ./packages/server/

RUN npm ci

# Copy source code
COPY packages/common ./packages/common
COPY packages/client ./packages/client
COPY packages/server ./packages/server

# Compile shared contracts & frontend bundle
RUN npm -w @wsm/common run build
RUN npm -w @wsm/client run build

# Stage 2: Minimal Production Runtime
FROM node:24-alpine AS runner

WORKDIR /app

# Install curl for container health checks
RUN apk add --no-cache curl

ENV NODE_ENV=production
ENV PORT=3001

# Copy package descriptors and install only production dependencies
COPY package*.json ./
COPY packages/common/package*.json ./packages/common/
COPY packages/server/package*.json ./packages/server/

RUN npm ci --omit=dev

# Copy compiled shared types
COPY --from=builder /app/packages/common/dist ./packages/common/dist

# Copy compiled frontend SPA bundle into client dist (Express static serving)
COPY --from=builder /app/packages/client/dist ./packages/client/dist

# Copy backend server source
COPY packages/server ./packages/server

# Create uploads and logs directories with proper permissions
RUN mkdir -p /app/packages/server/uploads /app/logs && \
    chown -R node:node /app

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3001/api/live || exit 1

CMD ["node", "packages/server/index.js"]
