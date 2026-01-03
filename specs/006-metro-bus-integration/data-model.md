# Data Model: Barcelona Metro, Bus, and TRAM Integration

**Last Updated**: 2025-12-27

## Data Sources Summary

### Successfully Downloaded

| Source | File | Records | Contents |
|--------|------|---------|----------|
| **TMB GTFS** | `tmb-metro-gtfs.zip` | 115 routes, 3,449 stops | Metro L1-L11 + TMB city buses + Funicular |
| Barcelona Open Data | `transports-bcn.csv` | 684 | Metro, FGC, RENFE, TRAM stations (coordinates only) |
| AMB Open Data | `tmb-gtfs.zip` | 131 routes, 4,852 stops | Metropolitan area buses (NOT TMB) |

### TMB GTFS Contents (Primary Data Source)

Downloaded via TMB API with credentials:
```
https://api.tmb.cat/v1/static/datasets/gtfs.zip?app_id={APP_ID}&app_key={APP_KEY}
```

| Route Type | Count | Lines |
|------------|-------|-------|
| Metro (type=1) | 10 | L1, L2, L3, L4, L5, L9N, L9S, L10N, L10S, L11 |
| Funicular (type=7) | 1 | FM (Montjuïc) |
| Bus (type=3) | 104 | D20, D40, H2-H16, V1-V33, numbered routes |

### To Be Investigated

| Source | URL | Contents |
|--------|-----|----------|
| TRAM OpenData | opendata.tram.cat | TRAM GTFS (T1-T6 lines) |

## Station Data Analysis

### Barcelona Transport CSV (`transports-bcn.csv`)

**Source**: https://opendata-ajuntament.barcelona.cat/data/ca/dataset/transports

| Type | Count | Description |
|------|-------|-------------|
| Metro i línies urbanes FGC | 518 | Metro + urban FGC stations (multiple entrances) |
| Tramvia | 56 | TRAM stations |
| Ferrocarrils Generalitat (FGC) | 54 | FGC commuter rail |
| RENFE | 33 | Rodalies/RENFE (already in our app) |
| Tren a l'aeroport | 9 | Airport train |
| Estació marítima | 8 | Maritime stations |
| Funicular | 4 | Funicular railways |
| Telefèric | 2 | Cable cars |

**Schema**:
```csv
CODI_CAPA,CAPA_GENERICA,NOM_CAPA,ED50_COORD_X,ED50_COORD_Y,ETRS89_COORD_X,ETRS89_COORD_Y,LONGITUD,LATITUD,EQUIPAMENT,DISTRICTE,BARRI,NOM_DISTRICTE,NOM_BARRI,ADRECA,TELEFON
```

**Key Fields**:
- `LONGITUD`, `LATITUD`: WGS84 coordinates (use these)
- `EQUIPAMENT`: Station name with format "Name (Additional info)-"
- `NOM_CAPA`: Transport type (Metro, FGC, RENFE, Tramvia, etc.)
- `NOM_DISTRICTE`, `NOM_BARRI`: District and neighborhood

**Important Note**: The 518 "Metro i línies urbanes FGC" entries include:
- Multiple entrances per metro station
- Does NOT indicate which Metro line (L1, L2, etc.) each station belongs to
- Need to join with route data to determine line assignments

### AMB Bus GTFS (`tmb-gtfs/`)

**Source**: http://www.amb.cat/Mobilitat/OpenData/google_transit.zip

This is **metropolitan area buses only** (NOT TMB city buses or Metro):

| File | Size | Description |
|------|------|-------------|
| `routes.txt` | 131 lines | Bus routes only (route_type=3) |
| `stops.txt` | 4,852 lines | Bus stops |
| `shapes.txt` | 8.4 MB | Route geometries |
| `stop_times.txt` | 43.5 MB | Arrival/departure times |

**Agencies included**: Soler i Sauret, DIREXIS TGO, DIREXIS TUSGSAL, Avanza, Monbus, Moventis (NOT TMB)

## TMB GTFS File Analysis

### File Record Counts

| File | Records | Notes |
|------|---------|-------|
| `routes.txt` | 115 | 10 Metro + 1 Funicular + 104 Bus |
| `stops.txt` | 3,449 | Includes parent stations and entrances |
| `trips.txt` | 91,088 | All scheduled trips |
| `stop_times.txt` | 2,122,014 | Arrival/departure times |
| `shapes.txt` | 98,610 | Line geometry points |
| `calendar_dates.txt` | 26,707 | Service exceptions |
| `pathways.txt` | 1,067 | Station accessibility paths |
| `transfers.txt` | 60 | Station transfers |

### Routes Structure (`routes.txt`)

```csv
route_id,route_short_name,route_long_name,route_type,route_url,route_color,route_text_color
1.1.1,L1,Hospital de Bellvitge - Fondo,1,...,CE1126,FFFFFF
1.2.1,L2,Paral·lel - Badalona Pompeu Fabra,1,...,93248F,FFFFFF
```

**Metro Line Colors:**
| Line | route_id | Color | Hex |
|------|----------|-------|-----|
| L1 | 1.1.1 | Red | #CE1126 |
| L2 | 1.2.1 | Purple | #93248F |
| L3 | 1.3.1 | Green | #1EB53A |
| L4 | 1.4.1 | Yellow | #F7A30E |
| L5 | 1.5.1 | Blue | #005A97 |
| L9N | 1.9.1 | Orange | #FB712B |
| L9S | 1.9.2 | Orange | #FB712B |
| L10N | 1.10.1 | Light Blue | #00A6D6 |
| L10S | 1.10.2 | Light Blue | #00A6D6 |
| L11 | 1.11.1 | Light Green | #89B94C |
| FM | 1.7.1 | Dark Green | #004C38 |

### Stops Structure (`stops.txt`)

```csv
stop_id,stop_code,stop_name,stop_lat,stop_lon,stop_url,location_type,parent_station,wheelchair_boarding
1.111,111,"Hospital de Bellvitge",41.344677,2.107242,,0,P.6660111,1
E.1011101,11101,"Ascensor - Residència sanitària",41.344324,2.106855,,2,P.6660111,1
P.6660111,6660111,"Hospital de Bellvitge",41.344677,2.107242,,1,,
```

**Location Types:**
- `0` = Stop/Platform (main station point)
- `1` = Parent Station (grouping entity)
- `2` = Entrance/Exit

### Shapes Structure (`shapes.txt`)

```csv
shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence
1.1.100.1,41.344677,2.107242,1
1.1.100.1,41.345012,2.107734,2
```

Shapes are referenced by `trips.trip_id` → `trips.shape_id` → `shapes.shape_id`.

---

## Database Schema Design

### Strategy: Multi-Network Support

Add a `network` column to dimension tables to support both Renfe and TMB data in the same schema.

### Schema Changes Required

#### 1. Add `network` column to existing tables

```sql
-- Add network discriminator to all dimension tables
ALTER TABLE dim_routes ADD COLUMN network TEXT NOT NULL DEFAULT 'renfe';
ALTER TABLE dim_stops ADD COLUMN network TEXT NOT NULL DEFAULT 'renfe';
ALTER TABLE dim_trips ADD COLUMN network TEXT NOT NULL DEFAULT 'renfe';
ALTER TABLE dim_stop_times ADD COLUMN network TEXT NOT NULL DEFAULT 'renfe';

-- Update primary keys to include network (requires recreation)
-- Routes: (network, route_id)
-- Stops: (network, stop_id)
-- Trips: (network, trip_id)
-- Stop Times: (network, trip_id, stop_sequence)
```

#### 2. Extend `dim_stops` for TMB-specific fields

```sql
ALTER TABLE dim_stops ADD COLUMN stop_code TEXT;
ALTER TABLE dim_stops ADD COLUMN location_type INTEGER DEFAULT 0;
ALTER TABLE dim_stops ADD COLUMN parent_station TEXT;
```

#### 3. New `dim_shapes` table for line geometries

```sql
CREATE TABLE IF NOT EXISTS dim_shapes (
    network TEXT NOT NULL DEFAULT 'renfe',
    shape_id TEXT NOT NULL,
    shape_pt_sequence INTEGER NOT NULL,
    shape_pt_lat DOUBLE PRECISION NOT NULL,
    shape_pt_lon DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (network, shape_id, shape_pt_sequence)
);

CREATE INDEX IF NOT EXISTS dim_shapes_by_shape_idx
    ON dim_shapes (network, shape_id);
```

### Final Table Schemas

#### `dim_routes`

```sql
CREATE TABLE dim_routes (
    network TEXT NOT NULL DEFAULT 'renfe',
    route_id TEXT NOT NULL,
    line_code TEXT,
    short_name TEXT,
    long_name TEXT,
    route_type INTEGER,        -- 1=Metro, 3=Bus, 7=Funicular
    color TEXT,                -- Hex color (without #)
    text_color TEXT,
    route_url TEXT,
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (network, route_id)
);
```

#### `dim_stops`

```sql
CREATE TABLE dim_stops (
    network TEXT NOT NULL DEFAULT 'renfe',
    stop_id TEXT NOT NULL,
    stop_code TEXT,
    name TEXT NOT NULL,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    location_type INTEGER DEFAULT 0,  -- 0=stop, 1=parent, 2=entrance
    parent_station TEXT,
    wheelchair_boarding INTEGER,
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (network, stop_id)
);
```

#### `dim_trips`

```sql
CREATE TABLE dim_trips (
    network TEXT NOT NULL DEFAULT 'renfe',
    trip_id TEXT NOT NULL,
    route_id TEXT,
    service_id TEXT,
    shape_id TEXT,
    direction_id INTEGER,
    trip_headsign TEXT,
    block_id TEXT,
    wheelchair_accessible INTEGER,
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (network, trip_id),
    FOREIGN KEY (network, route_id) REFERENCES dim_routes(network, route_id) ON DELETE SET NULL
);
```

#### `dim_stop_times`

```sql
CREATE TABLE dim_stop_times (
    network TEXT NOT NULL DEFAULT 'renfe',
    trip_id TEXT NOT NULL,
    stop_sequence INTEGER NOT NULL,
    stop_id TEXT NOT NULL,
    arrival_seconds INTEGER,
    departure_seconds INTEGER,
    PRIMARY KEY (network, trip_id, stop_sequence),
    FOREIGN KEY (network, trip_id) REFERENCES dim_trips(network, trip_id) ON DELETE CASCADE,
    FOREIGN KEY (network, stop_id) REFERENCES dim_stops(network, stop_id) ON DELETE CASCADE
);
```

#### `dim_shapes` (NEW)

```sql
CREATE TABLE dim_shapes (
    network TEXT NOT NULL DEFAULT 'renfe',
    shape_id TEXT NOT NULL,
    shape_pt_sequence INTEGER NOT NULL,
    shape_pt_lat DOUBLE PRECISION NOT NULL,
    shape_pt_lon DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (network, shape_id, shape_pt_sequence)
);
```

### Migration Strategy

1. **Phase 1**: Add columns with defaults (non-breaking)
   - Existing Renfe data automatically tagged as `network='renfe'`

2. **Phase 2**: Recreate tables with composite primary keys
   - Requires downtime or careful migration
   - Backup existing data first

3. **Phase 3**: Load TMB data with `network='tmb'`
   - No conflicts with existing Renfe data

### Network Values

| Network | Description | GTFS Source |
|---------|-------------|-------------|
| `renfe` | Rodalies de Catalunya | Renfe GTFS-RT |
| `tmb` | TMB Metro + Bus + Funicular | TMB API GTFS |
| `tram` | Barcelona TRAM (future) | TRAM OpenData |
| `fgc` | FGC Commuter Rail (future) | TBD |

---

## iBus API (Real-Time Predictions)

For future vehicle position estimation:

```
GET https://api.tmb.cat/v1/ibus/stops/{stop_code}?app_id={APP_ID}&app_key={APP_KEY}
```

Returns arrival predictions (minutes until arrival) per line at a stop.

## Comparison with Rodalies Data Model

### Current Rodalies Model

```typescript
interface TrainPosition {
  vehicleKey: string;         // Unique train ID
  latitude: number;           // Real-time GPS
  longitude: number;          // Real-time GPS
  nextStopId: string;         // GTFS stop_id
  routeId: string;            // e.g., "R1", "R2"
  status: 'IN_TRANSIT_TO' | 'STOPPED_AT';
  polledAtUtc: string;
}
```

### Proposed Multi-Network Model

```typescript
type TransportNetwork = 'rodalies' | 'metro' | 'bus' | 'tram' | 'fgc';

interface VehiclePosition {
  vehicleKey: string;
  networkType: TransportNetwork;
  latitude: number | null;     // Null for estimated positions
  longitude: number | null;
  estimatedLatitude?: number;  // When using schedule-based estimation
  estimatedLongitude?: number;
  nextStopId: string | null;
  routeId: string;             // e.g., "L1", "V15", "T4"
  lineColor: string;           // Hex color for visualization
  status: VehicleStatus;
  confidence: PositionConfidence;
  polledAtUtc: string;
  source: 'gps' | 'ibus' | 'schedule';
}

type PositionConfidence = 'high' | 'medium' | 'low' | 'unknown';
```

### Station Model Extension

```typescript
interface Station {
  id: string;
  name: string;
  networkType: TransportNetwork;
  lines: string[];             // ["L1", "L2"] for interchanges
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  entrances?: {                // For Metro with multiple entrances
    name: string;
    coordinates: [number, number];
  }[];
  district?: string;
  neighborhood?: string;
}
```

## Implementation Phases

### Phase 1: Static Data (No API Required)

Using downloaded `transports-bcn.csv`:

1. Display Metro stations on map (points only)
2. Display TRAM stations on map
3. Display FGC stations on map
4. Color-code by transport type

**Limitation**: Cannot show line-specific colors (L1 red, L2 purple, etc.) without line assignment data.

### Phase 2: Full TMB Integration (API Required)

After registering for TMB API:

1. Download full TMB GTFS with Metro lines
2. Match stations to lines for proper coloring
3. Display Metro line geometries (shapes.txt)
4. Display TMB city bus routes

### Phase 3: Real-Time Estimation (iBus API)

1. Poll iBus API for bus arrival predictions
2. Estimate bus positions along routes
3. Implement schedule-based Metro train positions
4. Add confidence indicators

## File Structure

Proposed data organization:

```
apps/web/public/
├── rodalies_data/           # Existing Rodalies data
│   ├── manifest.json
│   ├── stations.geojson
│   └── lines/
├── metro_data/              # New: Metro data
│   ├── manifest.json
│   ├── stations.geojson     # Derived from transports-bcn.csv
│   └── lines/               # From TMB GTFS shapes (future)
├── bus_data/                # New: Bus data
│   ├── manifest.json
│   ├── stops.geojson
│   └── routes/
└── tram_data/               # New: TRAM data
    ├── manifest.json
    ├── stops.geojson
    └── lines/
```

## Next Steps

1. [x] Register for TMB Developer Portal
2. [x] Download full TMB GTFS (Metro + City Bus)
3. [x] Analyze TMB GTFS file structure
4. [x] Design database schema for multi-network support
5. [ ] Migrate database tables (add `network` column, `dim_shapes`)
6. [ ] Extend poller to download and load TMB GTFS
7. [ ] Convert station/shape data to GeoJSON format for frontend
8. [ ] Create data loader for multi-network support
9. [ ] Design UI for network filtering
