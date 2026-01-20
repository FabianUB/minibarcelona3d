# =============================================================================
# Production Dockerfile for MiniBarcelona3D Web App
# Multi-stage build: Node for building, Nginx for serving
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build the React application
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source code
COPY . .

# Build argument for Mapbox token (injected at build time)
ARG VITE_MAPBOX_TOKEN
ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN

# Build the production bundle
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Serve with Nginx
# -----------------------------------------------------------------------------
FROM nginx:alpine

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# The public folder contains GeoJSON data that may be updated by the poller
# This will be mounted as a volume in production
# For now, copy the static data as fallback
COPY --from=builder /app/dist/rodalies_data /usr/share/nginx/html/rodalies_data
COPY --from=builder /app/dist/tmb_data /usr/share/nginx/html/tmb_data

# Expose port 80
EXPOSE 80

# Health check (must match docker-compose.prod.yml and nginx.conf /health endpoint)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -sf http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
