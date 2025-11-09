# Mini Rodalies 3D - Backend API

Go backend API for serving real-time train position data for the Rodalies (Barcelona commuter rail) network.

## Overview

This API provides endpoints for fetching real-time train positions, trip details, and schedule information. The data is sourced from a PostgreSQL database that's continuously updated with GTFS-RT (General Transit Feed Specification - Realtime) data.

## Technology Stack

- **Language:** Go 1.25.3
- **Router:** Chi v5
- **Database:** PostgreSQL with pgx v5 (connection pooling)
- **CORS:** Chi CORS middleware

## Getting Started

### Prerequisites

- Go 1.25.3 or higher
- PostgreSQL database with train data
- Environment variables configured (see below)

### Installation

```bash
cd apps/api
go mod download
```

### Environment Variables

Create a `.env` file in `apps/api/`:

```env
PORT=8080
DATABASE_URL=postgresql://user:password@localhost:5432/rodalies?sslmode=disable
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
```

### Running the Server

**Development:**
```bash
go run main.go
```

**Production:**
```bash
go build -o bin/api
./bin/api
```

**With Docker:**
```bash
docker-compose up api
```

### Running Tests

```bash
go test ./...
```

## API Endpoints

### Train Positions

#### GET `/api/trains/positions`

Returns lightweight position data for all active trains, optimized for frequent polling (every 30 seconds).

**Response:**
```json
{
  "positions": [
    {
      "vehicleKey": "71-470-004-00_51T0093R11_0",
      "latitude": 41.3851,
      "longitude": 2.1734,
      "nextStopId": "79409",
      "routeId": "51T0093R11",
      "status": "IN_TRANSIT_TO",
      "polledAtUTC": "2025-01-09T12:30:00Z"
    }
  ],
  "previousPositions": [...],
  "count": 95,
  "polledAt": "2025-01-09T12:30:00Z",
  "previousPolledAt": "2025-01-09T12:29:30Z"
}
```

**Caching:** `Cache-Control: public, max-age=15, stale-while-revalidate=10`

**Performance Target:** <50ms for ~100 trains

---

#### GET `/api/trains`

Returns full train details including all GTFS-RT fields.

**Query Parameters:**
- `route_id` (optional): Filter trains by route ID (e.g., `51T0093R11`)

**Response:**
```json
{
  "trains": [
    {
      "vehicleKey": "71-470-004-00_51T0093R11_0",
      "vehicleId": "71-470-004-00",
      "vehicleLabel": "004",
      "entityId": "71-470-004-00_51T0093R11",
      "tripId": "51T0093R11",
      "routeId": "51T0093R11",
      "latitude": 41.3851,
      "longitude": 2.1734,
      "currentStopId": null,
      "previousStopId": "79408",
      "nextStopId": "79409",
      "nextStopSequence": 5,
      "status": "IN_TRANSIT_TO",
      "arrivalDelaySeconds": 120,
      "departureDelaySeconds": 120,
      "scheduleRelationship": "SCHEDULED",
      "predictedArrivalUTC": "2025-01-09T12:32:00Z",
      "predictedDepartureUTC": "2025-01-09T12:32:30Z",
      "vehicleTimestampUTC": "2025-01-09T12:29:45Z",
      "polledAtUTC": "2025-01-09T12:30:00Z",
      "updatedAt": "2025-01-09T12:30:01Z",
      "snapshotId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "tripUpdateTimestampUTC": "2025-01-09T12:29:50Z"
    }
  ],
  "count": 95,
  "polledAt": "2025-01-09T12:30:00Z"
}
```

**Caching:** `Cache-Control: public, max-age=15, stale-while-revalidate=10`

**Performance Target:** <100ms for ~100 trains

---

#### GET `/api/trains/{vehicleKey}`

Returns full details for a specific train by its vehicle key.

**Parameters:**
- `vehicleKey` (path): Unique train identifier (e.g., `71-470-004-00_51T0093R11_0`)

**Response:**
```json
{
  "vehicleKey": "71-470-004-00_51T0093R11_0",
  "vehicleId": "71-470-004-00",
  "vehicleLabel": "004",
  ...
}
```

**Error Responses:**
- `404 Not Found`: Train not found
- `400 Bad Request`: Invalid vehicle key

**Caching:** `Cache-Control: public, max-age=10, stale-while-revalidate=5`

**Performance Target:** <10ms (primary key lookup)

---

### Trip Details

#### GET `/api/trips/{tripId}`

Returns schedule details for a specific trip, including all stops with scheduled and predicted times.

**Parameters:**
- `tripId` (path): Trip identifier (e.g., `51T0093R11`)

**Response:**
```json
{
  "tripId": "51T0093R11",
  "routeId": "R1",
  "stopTimes": [
    {
      "stopId": "79400",
      "stopSequence": 1,
      "stopName": "Barcelona-Sants",
      "scheduledArrival": "12:15:00",
      "scheduledDeparture": "12:15:00",
      "predictedArrivalUTC": "2025-01-09T12:17:00Z",
      "predictedDepartureUTC": "2025-01-09T12:17:30Z",
      "arrivalDelaySeconds": 120,
      "departureDelaySeconds": 150,
      "scheduleRelationship": "SCHEDULED"
    }
  ],
  "updatedAt": "2025-01-09T12:30:00Z"
}
```

**Error Responses:**
- `404 Not Found`: Trip not found
- `400 Bad Request`: Invalid trip ID

**Caching:** `Cache-Control: public, max-age=15, stale-while-revalidate=10`

**Use Case:** Delay calculation in TrainInfoPanel

---

## Database Schema

The API queries two main tables:

### `rt_rodalies_vehicle_current`

Current snapshot of all active trains (last known position).

**Key Columns:**
- `vehicle_key` (PK): Unique train identifier
- `latitude`, `longitude`: GPS coordinates
- `route_id`: Train route/line
- `status`: Movement status (IN_TRANSIT_TO, STOPPED_AT, etc.)
- `polled_at_utc`: When this data was collected
- `snapshot_id`: Links to rt_snapshots

### `rt_rodalies_vehicle_history`

Historical train positions for interpolation.

### `rt_trip_delays`

Real-time delay information per stop.

### `dim_stop_times`

Scheduled stop times from GTFS static data.

See `/docs/DATABASE_SCHEMA.md` for complete schema documentation.

---

## Performance Optimizations

### Connection Pooling (T101)

The repository uses pgx connection pooling with optimized settings:

```go
config.MaxConns = 10                        // Max connections
config.MinConns = 2                         // Min idle connections
config.MaxConnLifetime = 1 * time.Hour      // Recycle after 1 hour
config.MaxConnIdleTime = 5 * time.Minute    // Close idle after 5 min
config.HealthCheckPeriod = 30 * time.Second // Health checks
```

### HTTP Caching (T102)

All endpoints include appropriate `Cache-Control` headers:
- **Position endpoints:** 15 second cache (half of 30s polling interval)
- **Trip details:** 15 second cache (includes real-time delay data)
- **Stale-while-revalidate:** Allows serving slightly stale data while fetching fresh data

### Query Optimization

- Primary key lookups for single train queries
- Indexes on `route_id`, `vehicle_key`, `snapshot_id`
- Only active trains returned (updated within 10 minutes)

---

## Error Handling

All endpoints return consistent error responses:

```json
{
  "error": "Human-readable error message",
  "details": {
    "internal": "Detailed error for debugging",
    "vehicleKey": "context-specific-field"
  }
}
```

**HTTP Status Codes:**
- `200 OK`: Success
- `400 Bad Request`: Invalid input
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server error

---

## CORS Configuration

The API supports CORS for frontend integration. Allowed origins are configured via the `ALLOWED_ORIGINS` environment variable (comma-separated).

**Default:** `http://localhost:5173,http://localhost:3000`

---

## Monitoring & Logging

The API logs:
- Request method, path, and status code
- Query execution times (debug mode)
- Connection pool statistics
- Database errors

Example log output:
```
2025/01/09 12:30:00 GET /api/trains/positions - 200 (45ms)
```

---

## Development Tips

**Testing a single endpoint:**
```bash
curl http://localhost:8080/api/trains/positions | jq
```

**Check connection pool stats:**
The pool automatically logs health check results every 30 seconds.

**Hot reload during development:**
```bash
# Install air for hot reloading
go install github.com/cosmtrek/air@latest

# Run with hot reload
air
```

**Database connection test:**
```bash
go run main.go
# Look for "Database connection established" in logs
```

---

## Production Deployment

### Docker

Build and run with Docker:
```bash
docker build -t mini-rodalies-api .
docker run -p 8080:8080 --env-file .env mini-rodalies-api
```

### Environment Variables for Production

```env
PORT=8080
DATABASE_URL=postgresql://user:password@db-host:5432/rodalies?sslmode=require
ALLOWED_ORIGINS=https://yourdomain.com
```

### Health Check Endpoint

Use `/api/trains/positions` as a health check endpoint. A successful response indicates:
- API is running
- Database connection is healthy
- Data is being served

---

## API Contract

The API contract is defined in `contracts/api.yaml` (OpenAPI specification). This ensures consistency between frontend and backend.

---

## Contributing

When adding new endpoints:

1. Define the handler in `handlers/trains.go`
2. Add repository method in `repository/postgres.go`
3. Define request/response types in `models/`
4. Add route in `main.go`
5. Add appropriate caching headers
6. Update this README
7. Add tests in `handlers/*_test.go`

---

## License

Part of the Mini Rodalies 3D project.
