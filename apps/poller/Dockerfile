# Build stage
FROM golang:1.23-alpine AS builder

# Install build dependencies
RUN apk add --no-cache gcc musl-dev sqlite-dev

WORKDIR /app

# Copy go.mod and go.sum first for caching
COPY apps/poller/go.mod apps/poller/go.sum ./
RUN go mod download

# Copy source code
COPY apps/poller/ .

# Build all binaries with CGO enabled for SQLite
RUN CGO_ENABLED=1 GOOS=linux go build -o poller ./cmd/poller
RUN CGO_ENABLED=1 GOOS=linux go build -o import-gtfs ./cmd/import-gtfs
RUN CGO_ENABLED=1 GOOS=linux go build -o precalc-positions ./cmd/precalc-positions

# Runtime stage
FROM alpine:3.19

# Install runtime dependencies (wget for downloading GTFS)
RUN apk add --no-cache sqlite ca-certificates tzdata wget

WORKDIR /app

# Copy binaries from builder
COPY --from=builder /app/poller .
COPY --from=builder /app/import-gtfs .
COPY --from=builder /app/precalc-positions .

# Copy schema file and scripts (paths relative to root context)
# schema.sql is the single source of truth - also embedded in Go binary via go:embed
COPY apps/poller/internal/db/schema.sql /app/
COPY apps/poller/scripts/init-db.sh /app/

# Copy static web data for Metro/transit position estimation
# These GeoJSON files contain station locations needed by the poller
COPY apps/web/public/tmb_data /app/web_public/tmb_data
COPY apps/web/public/rodalies_data /app/web_public/rodalies_data

# Create data directory
RUN mkdir -p /data /data/gtfs

CMD ["./poller"]
