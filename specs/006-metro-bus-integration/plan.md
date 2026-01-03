# Implementation Plan: Barcelona Metro and Bus Integration

## Phase Overview

| Phase | Description | Dependencies | Est. Effort |
|-------|-------------|--------------|-------------|
| 1 | Static Station Display | None | Foundation |
| 2 | TMB GTFS Integration | TMB API key | Medium |
| 3 | Line Geometries | Phase 2 | Medium |
| 4 | Real-Time Estimation | Phase 3 + iBus | Complex |

---

## Phase 1: Static Station Display (No Auth Required)

### Goal
Display Metro, TRAM, and FGC stations on the map using publicly available data.

### Data Source
`transports-bcn.csv` from Barcelona Open Data (already downloaded)

### Tasks

#### T001: Create station data converter script
- Parse `transports-bcn.csv`
- Filter by transport type (Metro, TRAM, FGC)
- Output GeoJSON files per network type
- Handle multiple entrances (deduplicate stations)

#### T002: Create multi-network type definitions
- Define `TransportNetwork` enum
- Extend existing `Station` type
- Create network-specific color maps

#### T003: Extend data loader for multi-network
- Add `loadMetroStations()`, `loadTramStops()`, `loadFgcStations()`
- Integrate with existing `dataLoader.ts` caching
- Create manifest files for new data

#### T004: Create MetroLayer component
- Similar to existing `StationLayer`
- Use distinct marker style for Metro
- Display station names at high zoom

#### T005: Create TramLayer component
- Display TRAM stops
- Use TRAM-specific styling (line colors if available)

#### T006: Create network filter UI
- Toggle visibility per network type
- Add to settings or map controls
- Persist filter state

### Deliverables
- Metro stations visible on map (all one color, no line differentiation)
- TRAM stops visible on map
- FGC stations visible on map (separate from Rodalies)
- Network filter in UI

---

## Phase 2: TMB GTFS Integration (Auth Required)

### Goal
Download and process full TMB GTFS to get Metro line assignments and city bus data.

### Prerequisites
- TMB Developer account
- `APP_ID` and `APP_KEY` configured

### Tasks

#### T007: Download TMB GTFS with authentication
- Add TMB credentials to environment
- Create download script with auth headers
- Store GTFS in appropriate location

#### T008: Parse Metro line data from GTFS
- Extract routes.txt for Metro lines (route_type=1)
- Parse trips.txt for trip→route mapping
- Parse stop_times.txt for stop→trip→route mapping
- Build station→line assignment map

#### T009: Process Metro line geometries
- Parse shapes.txt for line geometries
- Convert to GeoJSON format
- Create per-line geometry files

#### T010: Update Metro stations with line info
- Assign line colors to stations
- Handle interchange stations (multiple lines)
- Update GeoJSON with line data

#### T011: Process TMB city bus routes
- Extract bus routes (route_type=3)
- Parse stop data
- Generate bus routes GeoJSON

### Deliverables
- Metro stations colored by line (L1 red, L2 purple, etc.)
- Metro line geometries on map
- TMB city bus routes available

---

## Phase 3: Line Geometries and Visualization

### Goal
Display complete line geometries for Metro, TRAM, and bus routes.

### Tasks

#### T012: Create MetroLineLayer component
- Render Metro line geometries
- Apply correct line colors
- Support line isolation mode (like Rodalies)

#### T013: Create TramLineLayer component
- Render TRAM line geometries
- Apply T1-T6 colors

#### T014: Create BusRouteLayer component
- Render bus route geometries
- Handle route selection
- Consider performance with ~100+ routes

#### T015: Integrate with highlight/isolate mode
- Extend existing MapStateProvider
- Support filtering by network + line
- Update legend component

### Deliverables
- Metro lines displayed underground (or as tunnels)
- TRAM lines displayed
- Bus routes optionally visible
- Unified filter/highlight system

---

## Phase 4: Real-Time Position Estimation

### Goal
Estimate vehicle positions for Metro and Bus using arrival predictions.

### Prerequisites
- iBus API access
- Schedule data from GTFS

### Tasks

#### T016: Create iBus API client
- Implement polling for arrival predictions
- Handle rate limits
- Cache predictions

#### T017: Implement schedule-based Metro estimation
- Calculate expected train positions from headways
- Place trains evenly along lines
- Animate movement based on time

#### T018: Implement iBus-based bus estimation
- Convert "X minutes until arrival" to position
- Interpolate between stops
- Handle multiple predictions for accuracy

#### T019: Add confidence indicators
- Show estimated vs real-time positions
- Opacity based on data freshness
- "Estimated" badge in info panels

#### T020: Create Metro/Bus vehicle visualization
- 3D models or markers for Metro trains
- Bus markers with route colors
- Integrate with existing trainMeshManager pattern

### Deliverables
- Estimated Metro train positions on map
- Estimated bus positions on map
- Clear visual distinction from GPS-tracked Rodalies
- Confidence indicators

---

## Technical Architecture

### Data Flow

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│ Barcelona       │────▶│ Station      │────▶│ GeoJSON Files   │
│ Open Data CSV   │     │ Converter    │     │ (static)        │
└─────────────────┘     └──────────────┘     └────────┬────────┘
                                                      │
┌─────────────────┐     ┌──────────────┐             │
│ TMB GTFS        │────▶│ GTFS Parser  │─────────────┤
│ (Metro + Bus)   │     │              │             │
└─────────────────┘     └──────────────┘             ▼
                                              ┌──────────────────┐
┌─────────────────┐     ┌──────────────┐     │ Frontend         │
│ iBus API        │────▶│ Position     │────▶│ (MapCanvas +     │
│ (real-time)     │     │ Estimator    │     │  Metro/Bus/Tram  │
└─────────────────┘     └──────────────┘     │  Layers)         │
                                              └──────────────────┘
```

### Component Hierarchy

```
App
├── MapCanvas
│   ├── RodaliesLineLayer (existing)
│   ├── StationLayer (existing, Rodalies)
│   ├── TrainLayer3D (existing)
│   ├── MetroLineLayer (new)
│   ├── MetroStationLayer (new)
│   ├── MetroVehicleLayer (new)
│   ├── TramLineLayer (new)
│   ├── TramStopLayer (new)
│   ├── BusRouteLayer (new)
│   └── BusStopLayer (new)
├── Legend (extend for multi-network)
├── NetworkFilter (new)
└── InfoPanels
    ├── TrainInfoPanel (existing)
    ├── StationInfoPanel (existing)
    ├── MetroInfoPanel (new)
    └── BusInfoPanel (new)
```

### State Management

Extend existing `MapStateProvider`:

```typescript
interface MapUIState {
  // Existing
  selectedLineId: string | null;
  highlightMode: HighlightMode;

  // New
  visibleNetworks: Set<TransportNetwork>;
  selectedNetwork: TransportNetwork | null;
  selectedMetroLine: string | null;
  selectedBusRoute: string | null;
}
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| TMB API registration takes time | Phase 1 works without API |
| iBus rate limits | Implement caching, reduce poll frequency |
| Metro visualization complexity | Start simple (stations only) |
| Performance with 100+ bus routes | Lazy loading, zoom-based visibility |
| No real GPS for Metro | Clear "estimated" indicators |

---

## Definition of Done

### Phase 1
- [ ] Metro stations visible on map
- [ ] TRAM stops visible on map
- [ ] FGC stations visible (distinct from Rodalies)
- [ ] Network filter working
- [ ] All tests passing

### Phase 2
- [ ] TMB API integrated
- [ ] Metro stations colored by line
- [ ] Metro line geometries displayed
- [ ] Bus routes data available

### Phase 3
- [ ] All line geometries rendered
- [ ] Highlight/isolate works across networks
- [ ] Legend shows all networks

### Phase 4
- [ ] Estimated positions for Metro
- [ ] Estimated positions for Bus
- [ ] Confidence indicators visible
- [ ] Info panels show estimation source
