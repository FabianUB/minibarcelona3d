# Quickstart: Real-Time Train Tracking

**Feature**: 002-realtime-train-tracking
**Branch**: `002-realtime-train-tracking`
**Status**: Planning Complete

## Overview

This guide walks through implementing real-time train tracking in **4 distinct phases**:

- **Phase A**: Go API + PostgreSQL (testable backend)
- **Phase B**: 2D markers on map (proof of concept)
- **Phase C**: 3D models with Three.js (visual enhancement)
- **Phase D**: Rich features (info panel, filtering)

Each phase delivers working, testable functionality. Don't skip ahead!

---

## Prerequisites

- ✅ Feature 001 (show-rodalies-map) implemented
- ✅ PostgreSQL database with `rt_rodalies_vehicle_current` table populated
- ✅ Go 1.25.3 installed
- ✅ Node.js 18+ with npm
- ✅ Docker (optional, for local PostgreSQL)

**Check database**:
```bash
# Verify table exists and has data
psql $DATABASE_URL -c "SELECT COUNT(*) FROM rt_rodalies_vehicle_current;"
# Should return count > 0 during active service hours
```

---

## Phase A: Go API + PostgreSQL

**Goal**: Build and test backend API serving train data from database.

**Deliverable**: Working `/api/trains` endpoint with tests.

### Step 1: Install Go dependencies

```bash
cd apps/api
go get github.com/jackc/pgx/v5
go get github.com/jackc/pgx/v5/pgxpool
```

**Why pgx?** See `research.md` - it's 20-30% faster than lib/pq and has built-in connection pooling.

### Step 2: Create database connection

Create `apps/api/repository/postgres.go`:

```go
package repository

import (
    "context"
    "github.com/jackc/pgx/v5/pgxpool"
)

type TrainRepository struct {
    pool *pgxpool.Pool
}

func NewTrainRepository(databaseURL string) (*TrainRepository, error) {
    pool, err := pgxpool.New(context.Background(), databaseURL)
    if err != nil {
        return nil, err
    }
    return &TrainRepository{pool: pool}, nil
}

func (r *TrainRepository) Close() {
    r.pool.Close()
}
```

### Step 3: Implement GetAllTrains query

Add to `apps/api/repository/postgres.go`:

```go
func (r *TrainRepository) GetAllTrains(ctx context.Context) ([]models.Train, error) {
    query := `
        SELECT
            vehicle_key, vehicle_id, vehicle_label, entity_id,
            trip_id, route_id,
            latitude, longitude,
            current_stop_id, previous_stop_id, next_stop_id, next_stop_sequence,
            status,
            arrival_delay_seconds, departure_delay_seconds,
            schedule_relationship,
            predicted_arrival_utc, predicted_departure_utc,
            vehicle_timestamp_utc, polled_at_utc, updated_at
        FROM rt_rodalies_vehicle_current
        ORDER BY vehicle_key
    `

    rows, err := r.pool.Query(ctx, query)
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var trains []models.Train
    for rows.Next() {
        var t models.Train
        err := rows.Scan(
            &t.VehicleKey, &t.VehicleID, &t.VehicleLabel, &t.EntityID,
            &t.TripID, &t.RouteID,
            &t.Latitude, &t.Longitude,
            &t.CurrentStopID, &t.PreviousStopID, &t.NextStopID, &t.NextStopSequence,
            &t.Status,
            &t.ArrivalDelaySeconds, &t.DepartureDelaySeconds,
            &t.ScheduleRelationship,
            &t.PredictedArrivalUTC, &t.PredictedDepartureUTC,
            &t.VehicleTimestampUTC, &t.PolledAtUTC, &t.UpdatedAt,
        )
        if err != nil {
            return nil, err
        }
        trains = append(trains, t)
    }

    return trains, rows.Err()
}
```

### Step 4: Create HTTP handler

Create `apps/api/handlers/trains.go`:

```go
package handlers

import (
    "encoding/json"
    "net/http"
    "time"
    "yourmodule/repository"
)

type TrainHandler struct {
    repo *repository.TrainRepository
}

func NewTrainHandler(repo *repository.TrainRepository) *TrainHandler {
    return &TrainHandler{repo: repo}
}

func (h *TrainHandler) GetAllTrains(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()

    trains, err := h.repo.GetAllTrains(ctx)
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }

    response := map[string]interface{}{
        "trains":   trains,
        "count":    len(trains),
        "polledAt": time.Now().UTC(),
    }

    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(response)
}
```

### Step 5: Wire up routes in main.go

Update `apps/api/main.go`:

```go
package main

import (
    "log"
    "net/http"
    "os"

    "github.com/go-chi/chi/v5"
    "github.com/go-chi/cors"
    "yourmodule/handlers"
    "yourmodule/repository"
)

func main() {
    databaseURL := os.Getenv("DATABASE_URL")
    if databaseURL == "" {
        log.Fatal("DATABASE_URL not set")
    }

    repo, err := repository.NewTrainRepository(databaseURL)
    if err != nil {
        log.Fatal("Failed to connect to database:", err)
    }
    defer repo.Close()

    trainHandler := handlers.NewTrainHandler(repo)

    r := chi.NewRouter()
    r.Use(cors.Handler(cors.Options{
        AllowedOrigins: []string{"http://localhost:5173"},
        AllowedMethods: []string{"GET", "OPTIONS"},
        AllowedHeaders: []string{"*"},
    }))

    r.Get("/api/trains", trainHandler.GetAllTrains)
    r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
        w.Write([]byte("ok"))
    })

    log.Println("API on :8080")
    http.ListenAndServe(":8080", r)
}
```

### Step 6: Test the API

```bash
# Set database connection
export DATABASE_URL="postgres://user:pass@localhost:5432/rodalies"

# Run API
go run main.go

# In another terminal, test endpoint
curl http://localhost:8080/api/trains | jq '.count'
# Should return number of active trains
```

### Step 7: Write integration test

Create `apps/api/tests/integration/trains_test.go`:

```go
package integration

import (
    "context"
    "testing"
    "yourmodule/repository"
)

func TestGetAllTrains(t *testing.T) {
    databaseURL := os.Getenv("TEST_DATABASE_URL")
    if databaseURL == "" {
        t.Skip("TEST_DATABASE_URL not set")
    }

    repo, err := repository.NewTrainRepository(databaseURL)
    if err != nil {
        t.Fatal(err)
    }
    defer repo.Close()

    trains, err := repo.GetAllTrains(context.Background())
    if err != nil {
        t.Fatal(err)
    }

    if len(trains) == 0 {
        t.Error("Expected at least one train")
    }

    // Validate first train
    if trains[0].VehicleKey == "" {
        t.Error("VehicleKey should not be empty")
    }
    if trains[0].Latitude < -90 || trains[0].Latitude > 90 {
        t.Errorf("Invalid latitude: %f", trains[0].Latitude)
    }
}
```

Run tests:
```bash
export TEST_DATABASE_URL="postgres://user:pass@localhost:5432/rodalies_test"
go test ./tests/integration/...
```

**Phase A Complete** ✅ when:
- `/api/trains` returns JSON with real train data
- Integration tests pass
- API responds in <100ms for ~100 trains

---

## Phase B: 2D Markers (Proof of Concept)

**Goal**: Display trains as simple 2D markers on map with real-time updates.

**Deliverable**: Working map with clickable train markers that update every 30s.

### Step 1: Install frontend dependencies

```bash
cd apps/web
# No new dependencies needed - using built-in Mapbox Markers
```

### Step 2: Create API client

Create `apps/web/src/lib/api/trains.ts`:

```typescript
import type { Train, TrainPosition } from '../../types/trains'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

export async function fetchAllTrains(routeId?: string): Promise<Train[]> {
  const url = routeId
    ? `${API_BASE}/trains?route_id=${routeId}`
    : `${API_BASE}/trains`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch trains: ${response.statusText}`)
  }

  const data = await response.json()
  return data.trains
}

export async function fetchTrainPositions(): Promise<TrainPosition[]> {
  const response = await fetch(`${API_BASE}/trains/positions`)
  if (!response.ok) {
    throw new Error(`Failed to fetch positions: ${response.statusText}`)
  }

  const data = await response.json()
  return data.positions
}
```

### Step 3: Create train marker component

Create `apps/web/src/features/trains/TrainMarkers.tsx`:

```typescript
import { useEffect, useState } from 'react'
import { Marker } from 'mapbox-gl'
import type { Map } from 'mapbox-gl'
import { fetchAllTrains } from '../../lib/api/trains'
import type { Train } from '../../types/trains'

interface TrainMarkersProps {
  map: Map | null
}

export function TrainMarkers({ map }: TrainMarkersProps) {
  const [trains, setTrains] = useState<Train[]>([])
  const [markers, setMarkers] = useState<Map<string, Marker>>(new Map())

  // Fetch trains on mount and poll every 30s
  useEffect(() => {
    if (!map) return

    const loadTrains = async () => {
      try {
        const data = await fetchAllTrains()
        setTrains(data)
      } catch (error) {
        console.error('Failed to load trains:', error)
      }
    }

    loadTrains()
    const interval = setInterval(loadTrains, 30000)
    return () => clearInterval(interval)
  }, [map])

  // Update markers when trains change
  useEffect(() => {
    if (!map || trains.length === 0) return

    const newMarkers = new Map<string, Marker>()

    trains.forEach(train => {
      let marker = markers.get(train.vehicleKey)

      if (!marker) {
        // Create new marker
        const el = document.createElement('div')
        el.className = 'train-marker'
        el.style.width = '12px'
        el.style.height = '12px'
        el.style.borderRadius = '50%'
        el.style.backgroundColor = '#f97316'
        el.style.border = '2px solid white'
        el.style.cursor = 'pointer'

        marker = new Marker(el)
          .setLngLat([train.longitude, train.latitude])
          .addTo(map)

        // Click handler for future info panel
        el.addEventListener('click', () => {
          console.log('Clicked train:', train.vehicleKey)
        })
      } else {
        // Update existing marker position
        marker.setLngLat([train.longitude, train.latitude])
      }

      newMarkers.set(train.vehicleKey, marker)
    })

    // Remove markers for trains that no longer exist
    markers.forEach((marker, key) => {
      if (!newMarkers.has(key)) {
        marker.remove()
      }
    })

    setMarkers(newMarkers)

    // Cleanup on unmount
    return () => {
      newMarkers.forEach(marker => marker.remove())
    }
  }, [map, trains])

  return null  // No visual component, just marker management
}
```

### Step 4: Add to MapCanvas

Update `apps/web/src/features/map/MapCanvas.tsx`:

```typescript
import { TrainMarkers } from '../trains/TrainMarkers'

// Inside MapCanvas component, after map initialization:
return (
  <div>
    <div ref={mapContainer} className="map-container" />
    {mapInstance && <TrainMarkers map={mapInstance} />}
  </div>
)
```

### Step 5: Test in browser

```bash
# Start API
cd apps/api && go run main.go

# Start frontend
cd apps/web && npm run dev

# Open http://localhost:5173
```

**Expected behavior**:
- Orange dots appear at train positions
- Dots update every 30 seconds
- Console logs when clicking a dot

**Phase B Complete** ✅ when:
- Markers render at correct GPS coordinates
- Markers update position every 30s
- No console errors
- E2E test passes (see below)

### E2E Test

Create `apps/web/e2e/train-markers.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'

test('train markers appear on map', async ({ page }) => {
  await page.goto('/')

  // Wait for map to load
  await page.waitForSelector('.mapboxgl-canvas')

  // Wait for markers to appear (max 5s)
  await page.waitForSelector('.train-marker', { timeout: 5000 })

  // Count markers
  const markerCount = await page.locator('.train-marker').count()
  expect(markerCount).toBeGreaterThan(0)

  console.log(`Found ${markerCount} train markers`)
})
```

Run: `npm run test:e2e -- train-markers.spec.ts`

---

## Phase C & D: See `/speckit.tasks`

Phases C (3D models) and D (rich features) will be broken down into detailed tasks using `/speckit.tasks` command after Phase B is complete.

---

## Troubleshooting

### API returns empty array

**Problem**: `{ "trains": [], "count": 0 }`

**Solutions**:
1. Check database has data: `SELECT COUNT(*) FROM rt_rodalies_vehicle_current;`
2. Verify poller is running and populating table
3. Check time of day (no trains during late night)

### Markers don't appear

**Problem**: Map loads but no markers visible

**Solutions**:
1. Check browser console for fetch errors
2. Verify API is running on port 8080
3. Check CORS headers in API response
4. Verify train coordinates are in map bounds

### Markers don't update

**Problem**: Markers render once but don't move

**Solutions**:
1. Check browser console for polling errors
2. Verify interval is running (add console.log)
3. Check if train positions actually changing in database

---

## Next Steps

After completing Phase B:

1. Run `/speckit.tasks` to generate Phase C & D implementation tasks
2. Tasks will cover:
   - Three.js integration
   - 3D model rendering
   - Info panel component
   - Stop details
   - Line filtering

See you in the tasks! 🚂
