# Quickstart: Barcelona Metro and Bus Integration

## Prerequisites

1. TMB Developer Account (for full Metro data)
2. Existing mini-rodalies-3d project setup

## TMB API Registration

To access complete Metro and Bus data:

1. Go to https://developer.tmb.cat/
2. Create an account
3. Create a new application
4. Note your `APP_ID` and `APP_KEY`
5. Add to `.env`:
   ```
   TMB_APP_ID=your_app_id
   TMB_APP_KEY=your_app_key
   ```

## Downloaded Data (No Auth Required)

### Barcelona Transport Stations

Already downloaded to `specs/006-metro-bus-integration/data/`:

```bash
# View transport types
cut -d',' -f3 transports-bcn.csv | sort | uniq -c

# Results:
#  518 "Metro i línies urbanes FGC"
#   56 "Tramvia"
#   54 "Ferrocarrils Generalitat (FGC)"
#   33 "RENFE"
#    9 "Tren a l'aeroport"
#    8 "Estació marítima"
#    4 "Funicular"
#    2 "Telefèric"
```

### AMB Metropolitan Buses

```bash
# Extract to data folder
cd specs/006-metro-bus-integration/data
unzip tmb-gtfs.zip -d amb-bus-gtfs

# View route count
wc -l amb-bus-gtfs/routes.txt  # 131 routes

# View stop count
wc -l amb-bus-gtfs/stops.txt   # 4,852 stops
```

## Converting Station Data to GeoJSON

```bash
# Create GeoJSON from CSV
node scripts/convert-stations-to-geojson.js

# Output will be in:
# - apps/web/public/metro_data/stations.geojson
# - apps/web/public/tram_data/stops.geojson
```

## TMB GTFS Download (Requires Auth)

```bash
# Download TMB GTFS (Metro + City Bus)
curl -H "app_id: $TMB_APP_ID" -H "app_key: $TMB_APP_KEY" \
  -o tmb-gtfs.zip \
  "https://api.tmb.cat/v1/static/datasets/gtfs.zip"

# Extract
unzip tmb-gtfs.zip -d tmb-gtfs

# This contains:
# - Metro lines (L1-L11) with geometries
# - TMB city bus routes (~100)
# - All stops with line assignments
```

## iBus API Testing (Requires Auth)

```bash
# Test iBus arrival predictions
curl -H "app_id: $TMB_APP_ID" -H "app_key: $TMB_APP_KEY" \
  "https://api.tmb.cat/v1/ibus/stops/1265"

# Response includes:
# - Next bus arrivals by line
# - Minutes until arrival
# - Destination
```

## Development Workflow

### Phase 1: Static Stations

```bash
# Start dev server
cd apps/web
npm run dev

# View Metro stations (once implemented)
# Navigate to localhost:5173
```

### Phase 2: Line Geometries

After TMB API registration:

```bash
# Process TMB GTFS
node scripts/process-tmb-gtfs.js

# This generates:
# - Line-colored stations
# - Metro line geometries
# - Route shapes
```

### Phase 3: Real-Time Estimation

```bash
# Start backend with iBus polling
cd apps/api
TMB_APP_ID=xxx TMB_APP_KEY=xxx go run .

# Frontend will show estimated positions
```

## Key Files to Create/Modify

### New Files

```
apps/web/src/
├── types/
│   └── transport.ts          # Multi-network types
├── lib/
│   ├── metro/
│   │   └── dataLoader.ts     # Metro data loading
│   ├── bus/
│   │   └── dataLoader.ts     # Bus data loading
│   └── tram/
│       └── dataLoader.ts     # TRAM data loading
├── features/
│   ├── metro/
│   │   ├── MetroLayer.tsx    # Metro visualization
│   │   └── MetroInfoPanel.tsx
│   ├── bus/
│   │   ├── BusLayer.tsx
│   │   └── BusInfoPanel.tsx
│   └── transport/
│       └── NetworkFilter.tsx  # Network type selector
└── state/
    └── transport/
        └── transportStore.ts  # Multi-network state
```

### Modified Files

```
apps/web/src/
├── App.tsx                   # Add new layers
├── features/map/MapCanvas.tsx # Integrate new layers
└── lib/rodalies/dataLoader.ts # Extend for multi-network
```

## Environment Variables

```env
# Existing
VITE_MAPBOX_TOKEN=pk.xxx
VITE_API_BASE=/api

# New for TMB
TMB_APP_ID=your_app_id
TMB_APP_KEY=your_app_key
VITE_TMB_ENABLED=true         # Feature flag
```

## Quick Test

```bash
# Run all tests
cd apps/web
npm test -- --run

# Check for new test failures
npm run lint
npm run build
```

## Resources

- TMB Developer Portal: https://developer.tmb.cat/
- TMB API Docs: https://developer.tmb.cat/api-docs/v1/transit
- Barcelona Open Data: https://opendata-ajuntament.barcelona.cat/
- TRAM Open Data: https://opendata.tram.cat/
