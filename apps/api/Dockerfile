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
RUN CGO_ENABLED=1 GOOS=linux go build -o api-server .

# Runtime stage
FROM alpine:3.19

# Install runtime dependencies
RUN apk add --no-cache sqlite ca-certificates tzdata

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/api-server .

# Run as non-root user
RUN adduser -D -H appuser
USER appuser

# Expose port
EXPOSE 8081

CMD ["./api-server"]
