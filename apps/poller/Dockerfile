# Build stage
FROM golang:1.23-alpine AS builder

# Install build dependencies
RUN apk add --no-cache gcc musl-dev sqlite-dev

WORKDIR /app

# Copy go.mod and go.sum first for caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

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

# Copy schema file and scripts
COPY schema.sql /app/
COPY scripts/init-db.sh /app/

# Create data and web_public directories
RUN mkdir -p /data /data/gtfs /app/web_public/rodalies_data /app/web_public/tmb_data/metro/lines /app/web_public/tmb_data/bus/routes

# Run as non-root user
RUN adduser -D -H appuser
RUN chown -R appuser:appuser /data /app
USER appuser

CMD ["./poller"]
