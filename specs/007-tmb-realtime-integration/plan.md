# TMB Real-Time API Integration - Implementation Plan

## Overview

Integrate TMB real-time APIs (iMetro, iBus) into the poller infrastructure to provide accurate vehicle positioning for Barcelona Metro and potentially Bus networks.

### Current State Analysis

**What Exists:**
- Static GeoJSON files for all networks: `apps/web/public/tmb_data/` (Metro, Bus, TRAM, FGC)
- TMB GTFS static refresh: `apps/poller/scripts/refresh_tmb_gtfs.py`
- Schedule-based simulation for Metro/Bus/TRAM/FGC on frontend
- Rodalies real-time polling every 60s with database persistence

**What's Missing:**
- Real-time polling for TMB networks
- Database tables for TMB real-time data
- API client for iMetro/iBus
- Frontend integration to consume real-time data

---

## TMB API Findings

### iMetro API (Metro Real-Time Arrivals)
- **Endpoint**: `https://api.tmb.cat/v1/itransit/metro/estacions?app_id={id}&app_key={key}`
- **Returns**: All metro lines in single request
- **Data Volume**: ~482 train arrivals across 249 station/direction combos
- **Update Frequency**: Real-time (new data each request)
- **Key Fields**:
  - `codi_servei` - Train ID (e.g., "104")
  - `temps_arribada` - Arrival timestamp in milliseconds
  - `codi_estacio` - Station code
  - `id_sentit` - Direction (1 or 2)
  - `desti_trajecte` - Destination name (e.g., "Fondo")

### iBus API (Bus Real-Time Arrivals)
- **Endpoint**: `https://api.tmb.cat/v1/ibus/stops/{stop_code}?app_id={id}&app_key={key}`
- **Returns**: Per-stop arrivals only
- **Problem**: 2600+ bus stops = expensive to poll all
- **Key Fields**:
  - `line` - Bus line code
  - `routeId` - GTFS route ID
  - `t-in-s` - Seconds until arrival
  - `destination` - Headsign

**Recommendation**: Start with Metro only (single API call), defer Bus real-time.

---

## Database Schema Changes

### New Tables

```sql
-- Metro real-time arrivals (raw from API)
CREATE TABLE rt_metro_arrivals (
    snapshot_id UUID NOT NULL REFERENCES rt_snapshots(snapshot_id),
    train_id TEXT NOT NULL,           -- codi_servei
    line_code TEXT NOT NULL,          -- e.g., "L1"
    station_code INTEGER NOT NULL,    -- codi_estacio
    direction INTEGER NOT NULL,       -- id_sentit (1 or 2)
    destination TEXT,                 -- desti_trajecte
    arrival_time_utc TIMESTAMPTZ NOT NULL, -- temps_arribada converted
    polled_at_utc TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (snapshot_id, train_id, station_code, direction)
);

-- Metro vehicles current (computed positions)
CREATE TABLE rt_metro_vehicle_current (
    vehicle_key TEXT PRIMARY KEY,     -- "metro-L1-104"
    snapshot_id UUID NOT NULL REFERENCES rt_snapshots(snapshot_id),
    train_id TEXT NOT NULL,
    line_code TEXT NOT NULL,
    direction INTEGER NOT NULL,
    -- Estimated position (interpolated between stations)
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    bearing DOUBLE PRECISION,
    -- Station context
    previous_station_code INTEGER,
    next_station_code INTEGER,
    next_station_arrival_utc TIMESTAMPTZ,
    progress_fraction DOUBLE PRECISION, -- 0.0-1.0 between stops
    -- Metadata
    polled_at_utc TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX rt_metro_vehicle_current_line_idx ON rt_metro_vehicle_current(line_code);
CREATE INDEX rt_metro_vehicle_current_polled_idx ON rt_metro_vehicle_current(polled_at_utc DESC);

-- Metro vehicles history (rolling 24h)
CREATE TABLE rt_metro_vehicle_history (
    vehicle_key TEXT NOT NULL,
    snapshot_id UUID NOT NULL REFERENCES rt_snapshots(snapshot_id),
    train_id TEXT NOT NULL,
    line_code TEXT NOT NULL,
    direction INTEGER NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    bearing DOUBLE PRECISION,
    previous_station_code INTEGER,
    next_station_code INTEGER,
    next_station_arrival_utc TIMESTAMPTZ,
    progress_fraction DOUBLE PRECISION,
    polled_at_utc TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (vehicle_key, snapshot_id)
);
```

---

## Position Interpolation Algorithm

Since iMetro only provides arrival times (not GPS), we interpolate position:

```python
def estimate_position(train_arrivals: list[TrainArrival], geometry_cache: dict) -> Position:
    """
    Given arrival predictions at stations, estimate current position.

    Example:
    - Train 104 arrives at Clot (station 126) in 2 minutes
    - Train 104 arrives at Navas (station 127) in 5 minutes
    - Segment Clot→Navas takes 3 minutes
    - Progress = (3 - 2) / 3 = 0.33 (33% from Clot to Navas)
    """
    # Find adjacent station arrivals for same train
    arrivals_by_train = group_by_train_id(train_arrivals)

    for train_id, arrivals in arrivals_by_train.items():
        sorted_arrivals = sorted(arrivals, key=lambda a: a.arrival_time)

        # Find the segment we're currently in
        now = time.time() * 1000
        for i in range(len(sorted_arrivals) - 1):
            current_arrival = sorted_arrivals[i]
            next_arrival = sorted_arrivals[i + 1]

            if current_arrival.arrival_time <= now < next_arrival.arrival_time:
                # We're between these two stations
                segment_duration = next_arrival.arrival_time - current_arrival.arrival_time
                time_remaining = next_arrival.arrival_time - now
                progress = 1 - (time_remaining / segment_duration)

                # Get geometry and interpolate
                segment_geom = get_segment_geometry(
                    current_arrival.station_code,
                    next_arrival.station_code,
                    geometry_cache
                )
                position = interpolate_along_line(segment_geom, progress)

                return Position(
                    latitude=position[1],
                    longitude=position[0],
                    bearing=calculate_bearing(segment_geom, progress),
                    progress_fraction=progress,
                    previous_station=current_arrival.station_code,
                    next_station=next_arrival.station_code,
                )

    return None  # Train not currently in service
```

---

## Implementation Phases

### Phase 1: Metro Real-Time (Core)
**Goal**: Poll iMetro API, store arrivals, compute positions

| Step | Description | Files |
|------|-------------|-------|
| 1.1 | Add database migration for Metro tables | `apps/poller/migrations/` |
| 1.2 | Create iMetro API client | `apps/poller/scripts/imetro_client.py` |
| 1.3 | Add Metro polling to main poller | `apps/poller/scripts/poll_to_postgres.py` |
| 1.4 | Create position interpolation module | `apps/poller/scripts/metro_position.py` |
| 1.5 | Add API endpoint in Go backend | `apps/api/handlers/metro.go` |
| 1.6 | Update frontend to fetch real-time data | `apps/web/src/lib/metro/` |

### Phase 2: Static Data Management
**Goal**: Download TMB/FGC/TRAM static files on poller start

| Step | Description | Files |
|------|-------------|-------|
| 2.1 | Create unified static download script | `apps/poller/scripts/refresh_all_static.py` |
| 2.2 | Add static refresh to poller startup | `apps/poller/scripts/poll_to_postgres.py` |
| 2.3 | Configure weekly refresh schedule | `.env`, `docker-compose.yml` |

### Phase 3: API Enhancements
**Goal**: Expose Metro real-time via Go API

| Step | Description | Files |
|------|-------------|-------|
| 3.1 | Add Metro positions endpoint | `apps/api/handlers/metro.go` |
| 3.2 | Add Metro arrivals endpoint | `apps/api/handlers/metro.go` |
| 3.3 | Update OpenAPI spec | `apps/api/openapi.yaml` |

### Phase 4: Frontend Integration
**Goal**: Replace schedule simulation with real-time API

| Step | Description | Files |
|------|-------------|-------|
| 4.1 | Create Metro API client | `apps/web/src/lib/api/metro.ts` |
| 4.2 | Update useMetroPositions hook | `apps/web/src/features/transit/hooks/useMetroPositions.ts` |
| 4.3 | Add fallback to schedule simulation | Same hook |

### Phase 5: Bus Real-Time (Future)
**Goal**: Add iBus API integration with selective polling

| Step | Description | Files |
|------|-------------|-------|
| 5.1 | Create iBus API client | `apps/poller/scripts/ibus_client.py` |
| 5.2 | Implement priority stop selection | Select high-traffic stops only |
| 5.3 | Add Bus polling to poller | Batch requests with rate limiting |

---

## Environment Variables

Add to `.env`:

```bash
# TMB API (already exist)
TMB_APP_ID=038e22a4
TMB_APP_KEY=0f84c6a45635c64f606d9e07f334a4e4

# Metro Polling
TMB_METRO_POLL_INTERVAL=30         # seconds (faster than Rodalies since it's lighter)
TMB_METRO_ENABLED=true

# Bus Polling (future)
TMB_BUS_POLL_INTERVAL=60
TMB_BUS_ENABLED=false
TMB_BUS_PRIORITY_STOPS=            # comma-separated stop codes

# Static Data Refresh
TMB_STATIC_REFRESH_DAY=0           # 0=Sunday, 1=Monday, etc.
TMB_STATIC_REFRESH_TIME=04:00      # Madrid time
```

---

## File Structure

```
apps/poller/scripts/
├── poll_to_postgres.py          # MODIFY: Add Metro/Bus polling
├── refresh_tmb_gtfs.py          # EXISTS: TMB static GTFS
├── refresh_all_static.py        # NEW: Unified static refresh
├── imetro_client.py             # NEW: iMetro API client
├── metro_position.py            # NEW: Position interpolation
├── ibus_client.py               # FUTURE: iBus API client
└── export_tmb_geojson.py        # EXISTS: GeoJSON export

apps/api/
├── handlers/
│   ├── trains.go                # EXISTS: Rodalies endpoints
│   └── metro.go                 # NEW: Metro endpoints
├── repository/
│   ├── postgres.go              # MODIFY: Add Metro queries
│   └── metro.go                 # NEW: Metro repository
└── models/
    └── metro.go                 # NEW: Metro models

apps/web/src/
├── lib/
│   ├── api/
│   │   ├── trains.ts            # EXISTS: Rodalies API
│   │   └── metro.ts             # NEW: Metro API client
│   └── metro/
│       └── dataLoader.ts        # MODIFY: Add API fallback
└── features/transit/hooks/
    └── useMetroPositions.ts     # MODIFY: Use real-time API
```

---

## API Endpoints

### Metro Positions
```
GET /api/v1/metro/positions
Response: {
  "positions": [
    {
      "vehicle_key": "metro-L1-104",
      "line_code": "L1",
      "train_id": "104",
      "latitude": 41.4194,
      "longitude": 2.1899,
      "bearing": 45.2,
      "previous_station_code": 126,
      "next_station_code": 127,
      "next_station_arrival_utc": "2024-12-30T12:35:00Z",
      "progress_fraction": 0.33,
      "polled_at_utc": "2024-12-30T12:32:15Z"
    }
  ],
  "polled_at_utc": "2024-12-30T12:32:15Z"
}
```

### Metro Arrivals (optional, for info panels)
```
GET /api/v1/metro/stations/{station_code}/arrivals
Response: {
  "station_code": 126,
  "arrivals": [
    {
      "line_code": "L1",
      "train_id": "104",
      "direction": 1,
      "destination": "Fondo",
      "arrival_time_utc": "2024-12-30T12:35:00Z",
      "minutes_away": 3
    }
  ]
}
```

---

## Polling Flow

```
┌────────────────────────────────────────────────────────────┐
│                    poll_to_postgres.py                      │
├────────────────────────────────────────────────────────────┤
│ Every 60s (Rodalies):                                       │
│   → Fetch vehicle_positions.pb                              │
│   → Parse + insert rt_rodalies_vehicle_current              │
│                                                             │
│ Every 30s (Metro):                                          │
│   → Fetch /v1/itransit/metro/estacions                     │
│   → Insert rt_metro_arrivals                                │
│   → Compute positions → rt_metro_vehicle_current            │
│                                                             │
│ Daily at 04:00 (Static):                                    │
│   → Download TMB/Renfe GTFS if updated                      │
│   → Refresh dimension tables                                │
│   → Export GeoJSON to frontend                              │
└────────────────────────────────────────────────────────────┘
```

---

## Success Criteria

1. Metro positions update every 30 seconds via real-time API
2. Position interpolation produces smooth movement between stations
3. Fallback to schedule simulation when API unavailable
4. Database retention: 24h rolling history
5. Static data auto-refreshes weekly
6. Frontend shows "real-time" or "simulated" indicator

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| TMB API rate limits | Implement exponential backoff, cache responses |
| API unavailable | Fallback to schedule-based simulation |
| Position interpolation inaccurate | Use actual segment geometry from GTFS shapes |
| iBus requires many requests | Start with schedule simulation, add priority stops later |

---

## Next Steps

1. Create database migration for Metro tables
2. Implement iMetro API client with error handling
3. Add Metro polling to main poller loop
4. Test position interpolation accuracy
5. Create Go API endpoints
6. Update frontend hooks to use API
