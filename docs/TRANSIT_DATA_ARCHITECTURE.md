# Transit Data Architecture

This document provides comprehensive documentation for all transit networks visualized in mini-barcelona-3d. Each section details the data sources, processing pipelines, storage schemas, and API endpoints for each transit system.

## Table of Contents

1. [Overview](#overview)
2. [Rodalies (Commuter Rail)](#rodalies-commuter-rail)
3. [Metro (Barcelona Metro)](#metro-barcelona-metro)
4. [Bus (TMB Bus Network)](#bus-tmb-bus-network)
5. [TRAM (Barcelona Tram)](#tram-barcelona-tram)
6. [FGC (Ferrocarrils de la Generalitat)](#fgc-ferrocarrils-de-la-generalitat)
7. [Database Schema Reference](#database-schema-reference)
8. [Docker Initialization](#docker-initialization)

---

## Overview

### Transit Networks Summary

| Network | Operator | Position Source | Update Frequency | Confidence |
|---------|----------|-----------------|------------------|------------|
| Rodalies | Renfe | Real-time GTFS-RT | 30 seconds | High |
| Metro | TMB | Real-time iMetro API | 30 seconds | Medium-High |
| Bus | TMB | Pre-calculated schedule | 30 seconds | Low |
| TRAM | TRAM Barcelona | Pre-calculated schedule | 30 seconds | Low |
| FGC | FGC | Pre-calculated schedule | 30 seconds | Low |

### Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA SOURCES                                    │
├─────────────────┬─────────────────┬─────────────────┬───────────────────────┤
│ Renfe GTFS-RT   │ iMetro API      │ TMB GTFS        │ TRAM/FGC GTFS         │
│ (Real-time)     │ (Real-time)     │ (Static)        │ (Static)              │
└────────┬────────┴────────┬────────┴────────┬────────┴───────────┬───────────┘
         │                 │                 │                     │
         ▼                 ▼                 ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              POLLER SERVICE                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Rodalies     │  │ Metro        │  │ Schedule     │  │ Init-DB      │     │
│  │ Client       │  │ Client       │  │ Estimator    │  │ (One-time)   │     │
│  │ (30s poll)   │  │ (30s poll)   │  │ (30s poll)   │  │              │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
│         │                 │                 │                 │             │
│         ▼                 ▼                 ▼                 ▼             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         SQLite Database                              │    │
│  │  rt_rodalies_*  │  rt_metro_*  │  pre_schedule_positions  │  dim_*  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API SERVER                                      │
│  GET /api/trains/*  │  GET /api/metro/*  │  GET /api/transit/schedule       │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                        │
│  Static GeoJSON (lines, stations)  +  Real-time positions from API          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Rodalies (Commuter Rail)

### Overview

Rodalies de Catalunya is the commuter rail network operated by Renfe, serving the Barcelona metropolitan area. This network has **real-time GPS tracking** via GTFS-RT feeds.

### Data Sources

#### 1. GTFS-RT Real-Time Feeds

| Feed | URL | Format | Data Provided |
|------|-----|--------|---------------|
| Vehicle Positions | `https://gtfsrt.renfe.com/vehicle_positions.pb` | Protobuf | GPS coordinates, trip association, stop sequence |
| Trip Updates | `https://gtfsrt.renfe.com/trip_updates.pb` | Protobuf | Arrival/departure delays, predictions |

**Authentication**: None required (public feeds)

**Polling Frequency**: Every 30 seconds

**Vehicle Position Data Fields**:
- `vehicle_id`: Unique vehicle identifier
- `vehicle_label`: Human-readable label (e.g., "R4-77626-PLATF.(1)")
- `trip_id`: Associated GTFS trip
- `latitude`, `longitude`: GPS coordinates
- `current_stop_id`: Current or next stop
- `current_status`: INCOMING_AT (0), STOPPED_AT (1), IN_TRANSIT_TO (2)
- `timestamp`: Vehicle GPS timestamp

**Trip Update Data Fields**:
- `trip_id`: GTFS trip identifier
- `stop_id`: Stop being updated
- `arrival_delay`: Seconds (+late, -early)
- `departure_delay`: Seconds (+late, -early)
- `schedule_relationship`: SCHEDULED, ADDED, CANCELED

#### 2. GTFS Static Data

| Source | URL | Update Frequency |
|--------|-----|------------------|
| Renfe GTFS | `https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip` | Downloaded on init, refreshed weekly |

**Contents**:
- 518 routes (all Rodalies lines including regional variants)
- 1,092 stations
- 123,293 trips
- 1,738,933 stop_times
- 360 calendar entries

### Line Code Extraction

The GTFS-RT feed doesn't provide `route_id` directly. Line codes are extracted from `vehicle_label` using regex:

```go
// Pattern: ^(R\d+[NS]?|RG\d+|RL\d+|RT\d+)
// Examples:
//   "R4-77626-PLATF.(1)" → "R4"
//   "R2N-12345-PLATF.(2)" → "R2N"
//   "RG1-98765" → "RG1"
```

**Line Types**:
- `R1-R8`: Urban/suburban Rodalies
- `R2N`, `R2S`: R2 North/South branches
- `RG1`: Girona regional
- `RL1-RL4`: Lleida regional
- `RT1`: Tarragona regional

### Geometry Sources

**Static GeoJSON Files** (committed to git):
```
apps/web/public/rodalies_data/
├── manifest.json              # File registry with checksums
├── RodaliesLine.json          # Line metadata (colors, names)
├── Station.geojson            # 200+ station points
├── LineGeometry.geojson       # All lines combined
├── lines/
│   ├── R1.geojson
│   ├── R2.geojson
│   ├── R2N.geojson
│   ├── R2S.geojson
│   ├── R3.geojson
│   ├── R4.geojson
│   └── ... (C1-C10, T1, RT1, RG1, RL1-4)
├── MapViewport.json           # Default camera position
└── MapUIState.json            # UI state
```

**Generation**: Created from GTFS `shapes.txt` by the poller's static refresh process.

### Position Processing Pipeline

```
1. Fetch vehicle_positions.pb (protobuf)
2. Parse GTFS-RT entities
3. Filter by vehicle_label prefix "R" (Rodalies only)
4. Extract line code from vehicle_label via regex
5. Fetch trip_updates.pb for delay information
6. Merge delays with positions by (trip_id, stop_id)
7. Lookup stop sequence from dim_stop_times
8. Determine previous/next stop based on status:
   - STOPPED_AT: stop_id is current
   - INCOMING_AT/IN_TRANSIT_TO: stop_id is next
9. Write to rt_rodalies_vehicle_current (upsert)
10. Copy to rt_rodalies_vehicle_history
```

### Railway Line Snapping

GPS positions are snapped to railway geometry for smooth visualization:

```typescript
// 1. Preprocess line into segments with cumulative distances
const segments = preprocessRailwayLine(lineGeometry);

// 2. Find closest segment to GPS position
const closestSegment = findClosestSegment(gpsPosition, segments);

// 3. Project position onto segment
const snappedPosition = projectOntoSegment(gpsPosition, closestSegment);

// 4. Calculate bearing from segment direction
const bearing = closestSegment.bearing;
```

### Database Tables

**rt_rodalies_vehicle_current** (latest position per train):
```sql
vehicle_key TEXT PRIMARY KEY,     -- Unique vehicle identifier
snapshot_id TEXT NOT NULL,        -- Polling snapshot reference
vehicle_id TEXT,                  -- GTFS-RT vehicle ID
vehicle_label TEXT,               -- Human-readable label
trip_id TEXT,                     -- Associated trip
route_id TEXT,                    -- Line code (R4, R2N, etc.)
latitude REAL, longitude REAL,    -- GPS position
current_stop_id TEXT,             -- Current or target stop
previous_stop_id TEXT,            -- Previous stop
next_stop_id TEXT,                -- Next stop
next_stop_sequence INTEGER,       -- Stop sequence number
status TEXT,                      -- INCOMING_AT, STOPPED_AT, IN_TRANSIT_TO
arrival_delay_seconds INTEGER,    -- Delay in seconds
departure_delay_seconds INTEGER,
schedule_relationship TEXT,       -- SCHEDULED, ADDED, CANCELED
predicted_arrival_utc TEXT,       -- Predicted arrival time
predicted_departure_utc TEXT,
vehicle_timestamp_utc TEXT,       -- GPS timestamp
polled_at_utc TEXT               -- When we polled
```

**rt_rodalies_vehicle_history** (24-hour rolling history):
- Same schema as current table
- Composite PK: (vehicle_key, snapshot_id)
- Used for animation interpolation

### API Endpoints

| Endpoint | Description | Cache |
|----------|-------------|-------|
| `GET /api/trains` | All active trains | 15s |
| `GET /api/trains/positions` | Lightweight position data | 15s |
| `GET /api/trains/{vehicleKey}` | Single train details | 10s |
| `GET /api/trips/{tripId}` | Trip with all stops | 15s |

**Response Example** (`/api/trains/positions`):
```json
{
  "positions": [
    {
      "vehicleKey": "R4-77626",
      "latitude": 41.3851,
      "longitude": 2.1734,
      "nextStopId": "71801",
      "routeId": "R4",
      "status": "IN_TRANSIT_TO",
      "polledAtUtc": "2026-01-04T18:30:00Z"
    }
  ],
  "previousPositions": [...],
  "count": 127,
  "polledAt": "2026-01-04T18:30:00Z",
  "previousPolledAt": "2026-01-04T18:29:30Z"
}
```

### Key Files

| Purpose | Path |
|---------|------|
| GTFS-RT Client | `apps/poller/internal/realtime/rodalies/client.go` |
| Database Writer | `apps/poller/internal/db/writer.go` |
| API Handler | `apps/api/handlers/trains.go` |
| Repository | `apps/api/repository/sqlite.go` |
| Frontend Data Loader | `apps/web/src/lib/rodalies/dataLoader.ts` |
| Frontend API Client | `apps/web/src/lib/api/trains.ts` |
| Geometry Utils | `apps/web/src/lib/trains/geometry.ts` |
| Static Data | `apps/web/public/rodalies_data/` |

---

## Metro (Barcelona Metro)

### Overview

Barcelona Metro is operated by TMB (Transports Metropolitans de Barcelona). Vehicle positions are **estimated from real-time arrival predictions** since trains don't have GPS tracking exposed publicly.

### Data Sources

#### 1. iMetro API (Real-Time Arrivals)

| Property | Value |
|----------|-------|
| Endpoint | `https://api.tmb.cat/v1/imetro/estacions` |
| Authentication | `app_id` + `app_key` query parameters |
| Format | JSON |
| Update Frequency | Polled every 30 seconds |

**Response Structure**:
```json
{
  "codi_linia": 1,              // Line number (1 = L1)
  "codi_via": 1,                // Direction (1=outbound, 2=inbound)
  "codi_estacio": 326,          // Station code
  "propers_trens": [
    {
      "codi_servei": "12345",   // Train ID
      "nom_linia": "L1",        // Line name
      "temps_restant": 180,     // Seconds until arrival
      "desti_trajecte": "Hospital de Bellvitge"
    }
  ]
}
```

**Environment Variables**:
```bash
TMB_APP_ID=<your-app-id>
TMB_APP_KEY=<your-app-key>
```

#### 2. TMB GTFS (Static)

| Property | Value |
|----------|-------|
| URL | `https://api.tmb.cat/v1/static/datasets/gtfs.zip` |
| Authentication | Same TMB credentials |
| Contents | Metro + Bus routes, stops, shapes |

### Metro Lines

| Line | Color | Terminal Stations |
|------|-------|-------------------|
| L1 | #E53935 (Red) | Hospital de Bellvitge ↔ Fondo |
| L2 | #7B1FA2 (Purple) | Paral·lel ↔ Badalona Pompeu Fabra |
| L3 | #43A047 (Green) | Zona Universitària ↔ Trinitat Nova |
| L4 | #FFB300 (Yellow) | Trinitat Nova ↔ La Pau |
| L5 | #1565C0 (Blue) | Cornellà Centre ↔ Vall d'Hebron |
| L9N | #F57C00 (Orange) | La Sagrera ↔ Can Zam |
| L9S | #F57C00 (Orange) | Aeroport T1 ↔ Zona Universitària |
| L10N | #00ACC1 (Cyan) | La Sagrera ↔ Gorg |
| L10S | #00ACC1 (Cyan) | Collblanc ↔ Zona Franca |
| L11 | #8BC34A (Light Green) | Trinitat Nova ↔ Can Cuiàs |
| FM | #795548 (Brown) | Paral·lel ↔ Montjuïc (Funicular) |

### Geometry Sources

**Static GeoJSON Files** (committed to git):
```
apps/web/public/tmb_data/metro/
├── stations.geojson           # All Metro stations (67 KB)
├── funicular_stations.geojson # Montjuïc funicular stations
└── lines/
    ├── L1.geojson             # Line geometries
    ├── L2.geojson
    ├── L3.geojson
    ├── L4.geojson
    ├── L5.geojson
    ├── L9N.geojson
    ├── L9S.geojson
    ├── L10N.geojson
    ├── L10S.geojson
    ├── L11.geojson
    └── FM.geojson
```

**Generation**: Created from TMB GTFS `shapes.txt` by the poller's static refresh process (requires TMB credentials).

### Position Estimation Algorithm

Since the iMetro API only provides arrival times (not GPS positions), train positions are **estimated** using this algorithm:

```
INPUT: Train arrival at Station S in T seconds

1. GROUPING:
   - Group all arrivals by train: (LineCode, Direction, TrainID)
   - Sort by arrival time (closest first)

2. STATUS DETERMINATION:
   - If T ≤ 0:  status = "STOPPED_AT" (train at station)
   - If T ≤ 30: status = "ARRIVING" (approaching platform)
   - Else:      status = "IN_TRANSIT_TO" (between stations)

3. POSITION ESTIMATION (for trains in transit):
   a. Load line geometry from GeoJSON
   b. Find station S position on line
   c. Estimate distance from station:
      - distance = T * avgSpeed (default 8.33 m/s ≈ 30 km/h)
   d. Find point on line that is 'distance' meters before S
   e. Interpolate position on line geometry

4. BEARING CALCULATION:
   - Calculate heading from interpolated position toward station S
   - Uses haversine formula

5. CONFIDENCE ASSIGNMENT:
   - T < 60s:  confidence = "high"
   - T < 300s: confidence = "medium"
   - T ≥ 300s: confidence = "low"

6. PROGRESS FRACTION:
   - progress = 1.0 - (T / defaultSegmentTime)
   - defaultSegmentTime = 120 seconds (2 minutes between stops)
```

### Database Tables

**rt_metro_vehicle_current**:
```sql
vehicle_key TEXT PRIMARY KEY,     -- "metro-L1-0-3" (network-line-dir-seq)
snapshot_id TEXT NOT NULL,
line_code TEXT NOT NULL,          -- "L1", "L2", etc.
route_id TEXT,                    -- TMB route format
direction_id INTEGER NOT NULL,    -- 0=outbound, 1=inbound
latitude REAL NOT NULL,           -- Estimated position
longitude REAL NOT NULL,
bearing REAL,                     -- Direction 0-360°
previous_stop_id TEXT,
next_stop_id TEXT,
previous_stop_name TEXT,
next_stop_name TEXT,
status TEXT NOT NULL,             -- STOPPED_AT, ARRIVING, IN_TRANSIT_TO
progress_fraction REAL,           -- 0.0-1.0 between stops
distance_along_line REAL,         -- Meters from line start
estimated_speed_mps REAL,         -- ~8.33 m/s (30 km/h)
line_total_length REAL,           -- Line length in meters
source TEXT DEFAULT 'imetro',
confidence TEXT NOT NULL,         -- high, medium, low
arrival_seconds_to_next INTEGER,  -- Seconds to next station
estimated_at_utc TEXT NOT NULL,
polled_at_utc TEXT NOT NULL
```

**rt_metro_vehicle_history**:
- Same core fields as current
- Composite PK: (vehicle_key, snapshot_id)
- Used for animation interpolation

### API Endpoints

| Endpoint | Description | Cache |
|----------|-------------|-------|
| `GET /api/metro/positions` | All Metro positions | 15s |
| `GET /api/metro/lines/{lineCode}` | Positions for specific line | 15s |

**Response Example** (`/api/metro/positions`):
```json
{
  "positions": [
    {
      "vehicleKey": "metro-L1-0-3",
      "networkType": "metro",
      "lineCode": "L1",
      "lineColor": "#E53935",
      "direction": 0,
      "latitude": 41.3774,
      "longitude": 2.1492,
      "bearing": 45.2,
      "previousStopId": "326",
      "nextStopId": "327",
      "previousStopName": "Espanya",
      "nextStopName": "Rocafort",
      "status": "IN_TRANSIT_TO",
      "progressFraction": 0.65,
      "confidence": "high",
      "arrivalSecondsToNext": 42,
      "polledAt": "2026-01-04T18:30:00Z"
    }
  ],
  "previousPositions": [...],
  "count": 156,
  "polledAt": "2026-01-04T18:30:00Z"
}
```

### Key Files

| Purpose | Path |
|---------|------|
| iMetro Client | `apps/poller/internal/realtime/metro/client.go` |
| Geometry Utils | `apps/poller/internal/realtime/metro/geometry.go` |
| API Handler | `apps/api/handlers/metro.go` |
| Repository | `apps/api/repository/sqlite.go` (SQLiteMetroRepository) |
| Frontend Data Loader | `apps/web/src/lib/metro/dataLoader.ts` |
| Position Simulator | `apps/web/src/lib/metro/positionSimulator.ts` |
| Metro Config | `apps/web/src/config/metroConfig.ts` |
| Static Data | `apps/web/public/tmb_data/metro/` |

---

## Bus (TMB Bus Network)

### Overview

TMB Bus is Barcelona's main bus network with 104+ routes. Unlike Rodalies and Metro, bus positions are **pre-calculated from static GTFS schedules** since the no public real-time API for bus GPS positions would be too costly to poll.

### Data Sources

#### GTFS Static Data

| Property | Value |
|----------|-------|
| Source | TMB GTFS ZIP (same as Metro) |
| URL | `https://api.tmb.cat/v1/static/datasets/gtfs.zip` |
| Local Copy | `data/gtfs/tmb_bus_gtfs.zip` |

**GTFS Contents** (after filtering):
- 104 bus routes (filtered by `route_type = 3`)
- 3,450 stops
- 60,520 trips
- 1,568,232 stop_times
- 24,075 calendar_dates

**Route Type Filtering**:
The TMB GTFS contains both Metro (type=1) and Bus (type=3). The import tool filters:
```go
if r.RouteType == 3 { // GTFS bus type code
    // Include this route
}
```

### Pre-Calculation Process

Bus positions are pre-calculated offline for each day type and time slot:

```
Day Types:
- weekday:  Monday-Thursday
- friday:   Friday (different schedule)
- saturday: Saturday
- sunday:   Sunday (and holidays)

Time Resolution:
- 30-second slots (2,880 slots per day)
- Slot number = seconds_since_midnight / 30

Pre-calculation Steps:
1. For each network (bus):
   a. Find representative date for each day type
   b. Query active trips for that date (via dim_calendar_dates)
   c. For each 30-second slot:
      - Find all trips active at this time
      - For each trip, interpolate position between stops
      - Calculate bearing toward next stop
      - Store as JSON array in pre_schedule_positions
```

**Position Interpolation**:
```
Given: current_time, trip with stop_times

1. Find segment where:
   prev_stop.departure ≤ current_time ≤ next_stop.arrival

2. Calculate fraction:
   elapsed = current_time - prev_stop.departure
   duration = next_stop.arrival - prev_stop.departure
   fraction = elapsed / duration

3. Interpolate position:
   lat = prev_lat + (next_lat - prev_lat) * fraction
   lon = prev_lon + (next_lon - prev_lon) * fraction

4. Calculate bearing from prev_stop to next_stop
```

### Geometry Sources

**Route Geometry**: Derived from GTFS `shapes.txt`
- Stored in database dim_* tables
- Not pre-rendered as GeoJSON (too many routes)

**Stop Locations**: From GTFS `stops.txt`
- 3,450 bus stops with coordinates
- Stored in `dim_stops` table

### Database Tables

**dim_routes** (bus routes):
```sql
route_id TEXT PRIMARY KEY,
network TEXT,                 -- "bus"
route_short_name TEXT,        -- "H8", "V15", "46"
route_long_name TEXT,         -- Full route name
route_type INTEGER,           -- 3 (bus)
route_color TEXT,             -- Hex color
route_text_color TEXT
```

**pre_schedule_positions**:
```sql
network TEXT NOT NULL,        -- "bus"
day_type TEXT NOT NULL,       -- "weekday", "friday", "saturday", "sunday"
time_slot INTEGER NOT NULL,   -- 0-2879 (30-second intervals)
positions_json TEXT NOT NULL, -- JSON array of positions
vehicle_count INTEGER NOT NULL,
PRIMARY KEY (network, day_type, time_slot)
```

**positions_json Format**:
```json
[
  {
    "vehicleKey": "bus-trip123456",
    "routeId": "001-H8",
    "routeShortName": "H8",
    "routeColor": "009EE0",
    "tripId": "trip123456",
    "direction": 0,
    "latitude": 41.3851,
    "longitude": 2.1734,
    "bearing": 90.5,
    "prevStopId": "2345",
    "nextStopId": "2346",
    "prevStopName": "Pl. Catalunya",
    "nextStopName": "Pg. de Gràcia",
    "progressFraction": 0.45,
    "scheduledArrival": "18:32"
  }
]
```

### API Endpoint

| Endpoint | Description | Cache |
|----------|-------------|-------|
| `GET /api/transit/schedule` | All schedule-based positions | 15s |
| `GET /api/transit/schedule?network=bus` | Bus only | 15s |

**How the API Works**:
```go
// 1. Determine Barcelona timezone
now := time.Now().In(barcelonaTZ) // Europe/Madrid

// 2. Determine day type
dayType := getDayType(now.Weekday())
// Mon-Thu → "weekday", Fri → "friday", Sat → "saturday", Sun → "sunday"

// 3. Calculate time slot
secondsSinceMidnight := now.Hour()*3600 + now.Minute()*60 + now.Second()
timeSlot := secondsSinceMidnight / 30

// 4. Query pre-calculated positions
SELECT positions_json FROM pre_schedule_positions
WHERE network = 'bus' AND day_type = ? AND time_slot = ?
```

### Vehicle Counts by Day Type

| Day Type | Average Vehicles | Peak Vehicles |
|----------|------------------|---------------|
| Weekday (Mon-Thu) | 245 | ~400 |
| Friday | 497 | ~700 |
| Saturday | 346 | ~500 |
| Sunday | 249 | ~350 |

### Key Files

| Purpose | Path |
|---------|------|
| GTFS Import | `apps/poller/cmd/import-gtfs/main.go` |
| Pre-calculation | `apps/poller/cmd/precalc-positions/main.go` |
| API Handler | `apps/api/handlers/schedule.go` |
| Repository | `apps/api/repository/sqlite.go` (SQLiteScheduleRepository) |
| GTFS Source | `data/gtfs/tmb_bus_gtfs.zip` |

---

## TRAM (Barcelona Tram)

### Overview

Barcelona has two tram networks operated by TRAM Barcelona:
- **Trambaix (TBX)**: Western lines (T1, T2, T3)
- **Trambesòs (TBS)**: Eastern lines (T4, T5, T6)

Like Bus, tram positions are **pre-calculated from static GTFS schedules**.

### Data Sources

#### GTFS Static Data

| Network | Source File | Size |
|---------|-------------|------|
| Trambaix | `data/gtfs/tram_tbx_gtfs.zip` | 704 KB |
| Trambesòs | `data/gtfs/tram_tbs_gtfs.zip` | 218 KB |

**Combined Contents**:
- 6 routes (T1-T6)
- 172 stops (86 per network)
- 5,342 trips (3,682 TBX + 1,660 TBS)
- 103,676 stop_times

### Tram Lines

| Line | Network | Route |
|------|---------|-------|
| T1 | Trambaix | Francesc Macià ↔ Consell Comarcal |
| T2 | Trambaix | Francesc Macià ↔ Llevant/Les Planes |
| T3 | Trambaix | Francesc Macià ↔ Sant Feliu/Consell Comarcal |
| T4 | Trambesòs | Ciutadella/Vila Olímpica ↔ Sant Adrià/Gorg |
| T5 | Trambesòs | Glòries ↔ Gorg |
| T6 | Trambesòs | Glòries ↔ Sant Adrià |

### Pre-Calculation Process

Same as Bus - positions pre-calculated by day type and time slot:

```
Networks: tram_tbs, tram_tbx (stored separately)
Display Type: "tram" (unified in API response)

Pre-calculation results:
- TBX weekday: 13 vehicles avg
- TBX friday: 13 vehicles avg
- TBX saturday: 9 vehicles avg
- TBX sunday: 9 vehicles avg
- TBS weekday: 10 vehicles avg
- TBS friday: 10 vehicles avg
- TBS saturday: 6 vehicles avg
- TBS sunday: 6 vehicles avg
```

### Geometry Sources

**GeoJSON Files** (would be in):
```
apps/web/public/tmb_data/tram/
├── lines/
│   ├── T1.geojson
│   ├── T2.geojson
│   ├── T3.geojson
│   ├── T4.geojson
│   ├── T5.geojson
│   └── T6.geojson
└── stations.geojson
```

### Database Storage

**Network Names in Database**:
- `tram_tbs` (Trambesòs)
- `tram_tbx` (Trambaix)

**API Network Mapping**:
```go
// When querying with ?network=tram
// Query both: WHERE network IN ('tram_tbs', 'tram_tbx')

// In response, map display type:
position.NetworkType = "tram" // Unified display name
```

### API Endpoint

| Endpoint | Description |
|----------|-------------|
| `GET /api/transit/schedule?network=tram` | All tram positions |

### Key Files

| Purpose | Path |
|---------|------|
| GTFS Sources | `data/gtfs/tram_tbs_gtfs.zip`, `data/gtfs/tram_tbx_gtfs.zip` |
| Network Detection | `apps/poller/cmd/import-gtfs/main.go` (lines 72-74) |

---

## FGC (Ferrocarrils de la Generalitat)

### Overview

FGC (Ferrocarrils de la Generalitat de Catalunya) operates urban and suburban rail lines in Catalonia. The Barcelona urban network includes the Llobregat-Anoia and Vallès lines.

Like Bus and TRAM, FGC positions are **pre-calculated from static GTFS schedules**.

### Data Sources

#### GTFS Static Data

| Property | Value |
|----------|-------|
| Source | `data/gtfs/fgc_gtfs.zip` |
| Size | 1.47 MB |

**Contents**:
- 21 routes
- 302 stations
- 18,089 trips
- 192,233 stop_times
- 1,841 calendar_dates

### FGC Lines

**Urban Network (Barcelona)**:
| Line | Route |
|------|-------|
| L6 | Pl. Catalunya ↔ Reina Elisenda |
| L7 | Pl. Catalunya ↔ Av. Tibidabo |
| L8 | Pl. Espanya ↔ Molí Nou - Ciutat Cooperativa |
| L12 | Pl. Espanya ↔ Gornal |
| S1 | Pl. Catalunya ↔ Terrassa Rambla |
| S2 | Pl. Catalunya ↔ Sabadell Rambla |
| S4 | Pl. Catalunya ↔ Olesa de Montserrat |
| S7 | Pl. Catalunya ↔ Universitat Autònoma |
| S8 | Pl. Catalunya ↔ Martorell |

**Montserrat/Funicular Lines**:
- Cremallera de Montserrat
- Funicular de Montserrat
- Funicular del Tibidabo

### Pre-Calculation Results

| Day Type | Trips | Avg Vehicles |
|----------|-------|--------------|
| Weekday | 1,375 | 23 |
| Friday | 2,179 | 43 |
| Saturday | 1,448 | 24 |
| Sunday | 1,299 | 23 |

### Geometry Sources

**GeoJSON Files** (would be in):
```
apps/web/public/tmb_data/fgc/
├── lines/
│   ├── L6.geojson
│   ├── L7.geojson
│   ├── L8.geojson
│   └── ...
└── stations.geojson
```

### Database Storage

**Network Name**: `fgc`

### API Endpoint

| Endpoint | Description |
|----------|-------------|
| `GET /api/transit/schedule?network=fgc` | All FGC positions |

### Key Files

| Purpose | Path |
|---------|------|
| GTFS Source | `data/gtfs/fgc_gtfs.zip` |

---

## Database Schema Reference

### Real-Time Tables

```sql
-- Rodalies current positions
CREATE TABLE rt_rodalies_vehicle_current (
    vehicle_key TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL,
    vehicle_id TEXT,
    vehicle_label TEXT,
    trip_id TEXT,
    route_id TEXT,
    latitude REAL,
    longitude REAL,
    current_stop_id TEXT,
    previous_stop_id TEXT,
    next_stop_id TEXT,
    next_stop_sequence INTEGER,
    status TEXT,
    arrival_delay_seconds INTEGER,
    departure_delay_seconds INTEGER,
    schedule_relationship TEXT,
    predicted_arrival_utc TEXT,
    predicted_departure_utc TEXT,
    vehicle_timestamp_utc TEXT,
    polled_at_utc TEXT NOT NULL,
    updated_at TEXT
);

-- Metro current positions
CREATE TABLE rt_metro_vehicle_current (
    vehicle_key TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL,
    line_code TEXT NOT NULL,
    route_id TEXT,
    direction_id INTEGER NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    bearing REAL,
    previous_stop_id TEXT,
    next_stop_id TEXT,
    previous_stop_name TEXT,
    next_stop_name TEXT,
    status TEXT NOT NULL,
    progress_fraction REAL,
    distance_along_line REAL,
    estimated_speed_mps REAL,
    line_total_length REAL,
    source TEXT NOT NULL DEFAULT 'imetro',
    confidence TEXT NOT NULL,
    arrival_seconds_to_next INTEGER,
    estimated_at_utc TEXT NOT NULL,
    polled_at_utc TEXT NOT NULL,
    updated_at TEXT
);
```

### Dimension Tables (GTFS Static)

```sql
-- Routes
CREATE TABLE dim_routes (
    route_id TEXT PRIMARY KEY,
    network TEXT NOT NULL,
    route_short_name TEXT,
    route_long_name TEXT,
    route_type INTEGER,
    route_color TEXT,
    route_text_color TEXT
);

-- Stops
CREATE TABLE dim_stops (
    stop_id TEXT PRIMARY KEY,
    network TEXT,
    stop_code TEXT,
    stop_name TEXT,
    stop_lat REAL,
    stop_lon REAL
);

-- Trips
CREATE TABLE dim_trips (
    trip_id TEXT PRIMARY KEY,
    network TEXT,
    route_id TEXT,
    service_id TEXT,
    trip_headsign TEXT,
    direction_id INTEGER
);

-- Stop Times
CREATE TABLE dim_stop_times (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    network TEXT,
    trip_id TEXT,
    stop_id TEXT,
    stop_sequence INTEGER,
    arrival_seconds INTEGER,
    departure_seconds INTEGER
);

-- Calendar
CREATE TABLE dim_calendar (
    service_id TEXT NOT NULL,
    network TEXT NOT NULL,
    monday INTEGER, tuesday INTEGER, wednesday INTEGER,
    thursday INTEGER, friday INTEGER, saturday INTEGER, sunday INTEGER,
    start_date TEXT, end_date TEXT,
    PRIMARY KEY (network, service_id)
);

-- Calendar Dates (Exceptions)
CREATE TABLE dim_calendar_dates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    network TEXT NOT NULL,
    service_id TEXT NOT NULL,
    date TEXT NOT NULL,
    exception_type INTEGER NOT NULL  -- 1=added, 2=removed
);
```

### Pre-Calculated Positions

```sql
CREATE TABLE pre_schedule_positions (
    network TEXT NOT NULL,
    day_type TEXT NOT NULL,
    time_slot INTEGER NOT NULL,
    positions_json TEXT NOT NULL,
    vehicle_count INTEGER NOT NULL,
    PRIMARY KEY (network, day_type, time_slot)
);
```

---

## Docker Initialization

### Init-DB Service

The `init-db` Docker service initializes all transit data on first startup:

```yaml
init-db:
  build: ./apps/poller
  volumes:
    - transit_data:/data
    - ./data/gtfs:/data/gtfs:ro
  command: ["sh", "/app/init-db.sh"]
```

**Initialization Steps** (`apps/poller/scripts/init-db.sh`):

1. Check if database already initialized
2. Download Rodalies GTFS from Renfe
3. Import all GTFS files:
   - Rodalies (fomento_transit.zip)
   - FGC (fgc_gtfs.zip)
   - TRAM TBS (tram_tbs_gtfs.zip)
   - TRAM TBX (tram_tbx_gtfs.zip)
   - Bus (tmb_bus_gtfs.zip)
4. Pre-calculate schedule positions for FGC, TRAM, Bus
5. Cleanup temporary files

**Timing**: ~1 minute on first run, instant skip on subsequent runs

### Data Sources After Init

| Network | Source | Updated |
|---------|--------|---------|
| Rodalies GTFS | Downloaded from Renfe | On init |
| Rodalies RT | GTFS-RT feeds | Every 30s |
| Metro | iMetro API | Every 30s |
| Metro Geometry | Git (pre-committed) | Manual/TMB refresh |
| Bus/TRAM/FGC | Pre-calculated from GTFS | On init |

---

## Summary Table

| Network | Provider | Position Source | Real-time? | Confidence | Update Freq |
|---------|----------|-----------------|------------|------------|-------------|
| Rodalies | Renfe | GTFS-RT GPS | Yes | High | 30s |
| Metro | TMB | iMetro arrivals → estimated | Yes | Medium | 30s |
| Bus | TMB | GTFS schedule → pre-calc | No | Low | 30s slot |
| TRAM | TRAM BCN | GTFS schedule → pre-calc | No | Low | 30s slot |
| FGC | FGC | GTFS schedule → pre-calc | No | Low | 30s slot |
