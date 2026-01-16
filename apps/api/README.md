# MiniBarcelona3D - Backend API

Go backend API for serving real-time transit position data for Barcelona's public transport networks (Rodalies, Metro, Bus, Tram, FGC).

## Overview

This API provides endpoints for fetching real-time vehicle positions, trip details, schedule information, and system health metrics. The data is sourced from a SQLite database that's continuously updated by the poller service with GTFS-RT and TMB API data.

## Technology Stack

- **Language:** Go 1.23
- **Router:** Chi v5
- **Database:** SQLite with mattn/go-sqlite3
- **CORS:** Chi CORS middleware

## Getting Started

### Prerequisites

- Go 1.23 or higher
- SQLite database with transit data (created by init-db service)
- Environment variables configured (see below)

### Installation

```bash
cd apps/api
go mod download
```

### Environment Variables

```bash
# Required
SQLITE_DATABASE=/data/transit.db    # Path to SQLite database

# Optional
PORT=8080                           # API port (default: 8080)
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
```

### Running the Server

**Development:**
```bash
go run .
```

**Production:**
```bash
go build -o bin/api .
./bin/api
```

**With Docker (recommended):**
```bash
docker-compose up api
```

### Running Tests

```bash
go test ./...
```

## API Endpoints

### Train Positions (Rodalies)

#### GET `/api/trains/positions`

Returns lightweight position data for all active Rodalies trains, optimized for frequent polling (every 30 seconds).

**Response:**
```json
{
  "positions": [
    {
      "vehicleKey": "R4-77626",
      "latitude": 41.3851,
      "longitude": 2.1734,
      "nextStopId": "79409",
      "routeId": "R4",
      "status": "IN_TRANSIT_TO",
      "polledAtUtc": "2026-01-09T12:30:00Z"
    }
  ],
  "previousPositions": [...],
  "count": 95,
  "polledAt": "2026-01-09T12:30:00Z",
  "previousPolledAt": "2026-01-09T12:29:30Z"
}
```

**Caching:** `Cache-Control: public, max-age=15, stale-while-revalidate=10`

---

#### GET `/api/trains`

Returns full train details including all GTFS-RT fields.

**Query Parameters:**
- `route_id` (optional): Filter trains by route ID

---

#### GET `/api/trains/{vehicleKey}`

Returns full details for a specific train by its vehicle key.

---

### Metro Positions

#### GET `/api/metro/positions`

Returns estimated positions for all Metro trains (derived from iMetro arrival predictions).

---

### Schedule-Based Positions (Bus, Tram, FGC)

#### GET `/api/transit/schedule`

Returns pre-calculated positions from GTFS schedules.

**Query Parameters:**
- `network` (optional): Filter by network (`bus`, `tram`, `fgc`)

---

### Health & Observability

#### GET `/api/health/networks`

Returns health status for all transit networks including:
- Health scores (0-100)
- Vehicle counts vs expected baselines
- Data freshness metrics
- Uptime percentages

#### GET `/api/health/history`

Returns health score history for sparkline visualization.

#### GET `/api/health/baselines`

Returns baseline learning statistics (Welford's algorithm).

---

## Database Schema

The API queries SQLite tables organized into:

### Real-Time Tables
- `rt_rodalies_vehicle_current` - Current Rodalies train positions
- `rt_metro_vehicle_current` - Current Metro positions (estimated)

### Schedule Tables
- `pre_schedule_positions` - Pre-calculated Bus/Tram/FGC positions

### Metrics Tables
- `metrics_baselines` - Learned baseline statistics per network/hour/day
- `metrics_health_history` - Health score history for uptime calculation

### Dimension Tables (GTFS Static)
- `dim_routes`, `dim_trips`, `dim_stops`, `dim_stop_times`

See `/docs/DATABASE_SCHEMA.md` for complete schema documentation.

---

## Repository Pattern

The API uses the repository pattern to abstract database operations:

```
apps/api/
├── handlers/          # HTTP handlers (request/response logic)
│   ├── trains.go      # Rodalies endpoints
│   ├── metro.go       # Metro endpoints
│   ├── schedule.go    # Bus/Tram/FGC endpoints
│   └── health.go      # Health & observability
├── repository/        # Database access layer
│   └── sqlite.go      # SQLite implementation
└── models/            # Data structures
```

This separation allows:
- Testing handlers with mock repositories
- Swapping database implementations without changing handlers
- Centralized query optimization

---

## Error Handling

All endpoints return consistent error responses:

```json
{
  "error": "Human-readable error message",
  "details": {
    "internal": "Detailed error for debugging"
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

## Production Deployment

### Docker

```bash
docker build -t mini-barcelona-api .
docker run -p 8080:8080 -v /data:/data mini-barcelona-api
```

### Health Check

Use `/api/health/networks` as a health check endpoint. A successful response indicates:
- API is running
- Database connection is healthy
- Data is being served

---

## Contributing

When adding new endpoints:

1. Define the handler in `handlers/`
2. Add repository method in `repository/sqlite.go`
3. Define request/response types in `models/`
4. Add route in `main.go`
5. Add appropriate caching headers
6. Update this README
7. Add tests

---

## License

Part of the MiniBarcelona3D project.
