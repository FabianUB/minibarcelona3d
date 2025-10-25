# Data Model

**Feature**: Real-Time Train Tracking
**Date**: 2025-10-24
**Source**: `/docs/DATABASE_SCHEMA.md` - `rt_rodalies_vehicle_current` table

## Overview

This document defines domain models that map directly to the existing PostgreSQL schema. Our primary data source is the `rt_rodalies_vehicle_current` table, which contains real-time snapshots of all active Rodalies trains.

---

## Backend Model (Go)

### Train

Maps 1:1 to `rt_rodalies_vehicle_current` table rows.

```go
package models

import (
    "time"
    "github.com/google/uuid"
)

// Train represents a single active train's current state from rt_rodalies_vehicle_current
type Train struct {
    // Primary identifier
    VehicleKey   string    `db:"vehicle_key" json:"vehicleKey"`

    // Identity fields (nullable in DB)
    VehicleID    *string   `db:"vehicle_id" json:"vehicleId"`
    VehicleLabel string    `db:"vehicle_label" json:"vehicleLabel"`
    EntityID     string    `db:"entity_id" json:"entityId"`

    // Trip context (nullable in DB)
    TripID       *string   `db:"trip_id" json:"tripId"`
    RouteID      string    `db:"route_id" json:"routeId"`

    // Position
    Latitude     float64   `db:"latitude" json:"latitude"`
    Longitude    float64   `db:"longitude" json:"longitude"`

    // Stop context (nullable in DB)
    CurrentStopID   *string `db:"current_stop_id" json:"currentStopId"`
    PreviousStopID  *string `db:"previous_stop_id" json:"previousStopId"`
    NextStopID      *string `db:"next_stop_id" json:"nextStopId"`
    NextStopSequence *int   `db:"next_stop_sequence" json:"nextStopSequence"`

    // Status
    Status      string     `db:"status" json:"status"` // GTFS VehicleStopStatus

    // Delay information (nullable in DB)
    ArrivalDelaySeconds    *int `db:"arrival_delay_seconds" json:"arrivalDelaySeconds"`
    DepartureDelaySeconds  *int `db:"departure_delay_seconds" json:"departureDelaySeconds"`

    // Schedule relationship and predictions (nullable in DB)
    ScheduleRelationship   *string    `db:"schedule_relationship" json:"scheduleRelationship"`
    PredictedArrivalUTC    *time.Time `db:"predicted_arrival_utc" json:"predictedArrivalUtc"`
    PredictedDepartureUTC  *time.Time `db:"predicted_departure_utc" json:"predictedDepartureUtc"`

    // Timestamps
    VehicleTimestampUTC    *time.Time `db:"vehicle_timestamp_utc" json:"vehicleTimestampUtc"`
    PolledAtUTC            time.Time  `db:"polled_at_utc" json:"polledAtUtc"`
    UpdatedAt              time.Time  `db:"updated_at" json:"updatedAt"`

    // Metadata (not exposed to frontend initially)
    SnapshotID             uuid.UUID  `db:"snapshot_id" json:"-"`
    TripUpdateTimestampUTC *time.Time `db:"trip_update_timestamp_utc" json:"-"`
}
```

**Field Notes**:
- **VehicleKey**: Guaranteed unique identifier (use this for all joins/lookups)
- **VehicleID**: May be null if feed doesn't provide it
- **NextStopID**: Critical for calculating train orientation
- **RouteID**: Links to Line data from feature 001
- **Delay fields**: Negative values mean early, positive means late
- **Timestamps**: All UTC, use `PolledAtUTC` to detect stale data

---

### TrainPosition (Minimal Payload)

Subset of Train for efficient polling responses. Used in Phase B.

```go
// TrainPosition is a lightweight model for frequent position updates
type TrainPosition struct {
    VehicleKey   string    `json:"vehicleKey"`
    Latitude     float64   `json:"latitude"`
    Longitude    float64   `json:"longitude"`
    NextStopID   *string   `json:"nextStopId"`
    RouteID      string    `json:"routeId"`
    Status       string    `json:"status"`
    PolledAtUTC  time.Time `json:"polledAtUtc"`
}
```

**Rationale**: Reduces JSON payload size for `/api/trains/positions` endpoint that polls every 15-30s.

---

## Frontend Model (TypeScript)

### Train

Client-side representation matching Go JSON serialization.

```typescript
// apps/web/src/types/trains.ts

export interface Train {
  // Identity
  vehicleKey: string
  vehicleId: string | null
  vehicleLabel: string
  entityId: string

  // Trip context
  tripId: string | null
  routeId: string  // Links to Line.id from feature 001

  // Position
  latitude: number
  longitude: number

  // Stop context
  currentStopId: string | null
  previousStopId: string | null
  nextStopId: string | null
  nextStopSequence: number | null

  // Status
  status: VehicleStatus

  // Delay
  arrivalDelaySeconds: number | null
  departureDelaySeconds: number | null

  // Schedule & predictions
  scheduleRelationship: string | null
  predictedArrivalUtc: string | null  // ISO 8601
  predictedDepartureUtc: string | null  // ISO 8601

  // Timestamps
  vehicleTimestampUtc: string | null  // ISO 8601
  polledAtUtc: string  // ISO 8601
  updatedAt: string    // ISO 8601
}

export type VehicleStatus =
  | 'IN_TRANSIT_TO'
  | 'STOPPED_AT'
  | 'INCOMING_AT'
  | string  // Allow other GTFS statuses

export interface TrainPosition {
  vehicleKey: string
  latitude: number
  longitude: number
  nextStopId: string | null
  routeId: string
  status: VehicleStatus
  polledAtUtc: string  // ISO 8601
}
```

---

## Database Query Patterns

### Phase A: Get All Active Trains

```sql
SELECT
  vehicle_key,
  vehicle_id,
  vehicle_label,
  trip_id,
  route_id,
  latitude,
  longitude,
  next_stop_id,
  status,
  arrival_delay_seconds,
  departure_delay_seconds,
  polled_at_utc,
  updated_at
FROM rt_rodalies_vehicle_current
ORDER BY vehicle_key;
```

**Performance**: Uses `rt_rodalies_vehicle_current_vehicle_id_idx` index. Expected <50ms for ~100 rows.

---

### Phase A: Get Trains by Route (for filtering)

```sql
SELECT * FROM rt_rodalies_vehicle_current
WHERE route_id = $1
ORDER BY next_stop_sequence;
```

**Performance**: Uses `rt_rodalies_vehicle_current_route_idx` index.

---

### Phase A: Get Single Train Details

```sql
SELECT * FROM rt_rodalies_vehicle_current
WHERE vehicle_key = $1;
```

**Performance**: Primary key lookup, sub-millisecond.

---

### Stale Data Detection

```sql
SELECT
  vehicle_key,
  polled_at_utc,
  EXTRACT(EPOCH FROM (NOW() - polled_at_utc)) as seconds_since_update
FROM rt_rodalies_vehicle_current
WHERE EXTRACT(EPOCH FROM (NOW() - polled_at_utc)) > 60
ORDER BY polled_at_utc DESC;
```

**Usage**: Detect trains with no updates in last 60 seconds. Display warning in UI.

---

## Computed Fields (Frontend)

### Bearing to Next Station

```typescript
// apps/web/src/lib/trains/geometry.ts

export function calculateBearingToNextStop(
  train: Train,
  stations: Map<string, Station>  // From feature 001
): number | null {
  if (!train.nextStopId) return null

  const nextStation = stations.get(train.nextStopId)
  if (!nextStation) return null

  return calculateBearing(
    train.latitude,
    train.longitude,
    nextStation.latitude,
    nextStation.longitude
  )
}

function calculateBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180

  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)

  const θ = Math.atan2(y, x)
  return ((θ * 180) / Math.PI + 360) % 360  // Normalize to [0, 360)
}
```

---

### Delay Display

```typescript
export function formatDelay(train: Train): string {
  const delay = train.arrivalDelaySeconds ?? train.departureDelaySeconds

  if (delay === null) return 'Unknown'
  if (delay === 0) return 'On time'
  if (delay > 0) {
    const minutes = Math.floor(delay / 60)
    return minutes > 0 ? `${minutes} min late` : `${delay}s late`
  }

  const minutes = Math.floor(Math.abs(delay) / 60)
  return minutes > 0 ? `${minutes} min early` : `${Math.abs(delay)}s early`
}
```

---

## Null Handling

### Go Backend

Nullable database columns map to Go pointers:

```go
var train Train
err := db.Get(&train, query, vehicleKey)

// Safe access
if train.NextStopID != nil {
    nextStop := *train.NextStopID
}
```

### TypeScript Frontend

Nullable fields use union types:

```typescript
if (train.nextStopId !== null) {
  const bearing = calculateBearingToNextStop(train, stations)
}
```

---

## Validation Rules

### Backend (Go)

```go
func (t *Train) Validate() error {
    if t.VehicleKey == "" {
        return errors.New("vehicle_key is required")
    }
    if !strings.HasPrefix(t.VehicleLabel, "R") {
        return errors.New("vehicle_label must start with R")
    }
    if t.Latitude < -90 || t.Latitude > 90 {
        return errors.New("latitude out of range")
    }
    if t.Longitude < -180 || t.Longitude > 180 {
        return errors.New("longitude out of range")
    }
    return nil
}
```

---

## Future Extensions (Out of Scope for 002)

### TripDetails with Stop Times

For Phase D (rich features), we'll need to query static GTFS data to get full stop lists. This will require joining with additional tables (not yet defined):

```go
// Future model for Phase D
type TripDetails struct {
    TripID       string     `json:"tripId"`
    RouteID      string     `json:"routeId"`
    Direction    string     `json:"direction"`
    Stops        []StopTime `json:"stops"`
}

type StopTime struct {
    StopID              string     `json:"stopId"`
    StopSequence        int        `json:"stopSequence"`
    ScheduledArrival    *time.Time `json:"scheduledArrival"`
    PredictedArrival    *time.Time `json:"predictedArrival"`
    Status              string     `json:"status"`  // completed | current | upcoming
}
```

**Note**: Design this in Phase D planning. May require additional database tables or static GTFS files.

---

## Summary

| Model | Purpose | Source Table | Phase |
|-------|---------|--------------|-------|
| Train (full) | Complete train state | `rt_rodalies_vehicle_current` | A, D |
| TrainPosition | Minimal polling payload | `rt_rodalies_vehicle_current` (subset) | B |
| Bearing (computed) | 3D orientation | Calculated from nextStopId + station coords | C |
| TripDetails (future) | Full stop schedule | TBD (static GTFS + history) | D |

**Next**: Create API contracts in `contracts/api.yaml`
