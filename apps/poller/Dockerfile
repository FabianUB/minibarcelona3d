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

# Build with CGO enabled for SQLite
RUN CGO_ENABLED=1 GOOS=linux go build -o poller ./cmd/poller

# Runtime stage
FROM alpine:3.19

# Install runtime dependencies
RUN apk add --no-cache sqlite ca-certificates tzdata

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/poller .

# Copy schema file for reference (DB init handled separately)
COPY schema.sql /app/

# Create data directory
RUN mkdir -p /data /data/cache

# Run as non-root user
RUN adduser -D -H appuser
RUN chown -R appuser:appuser /data
USER appuser

CMD ["./poller"]
