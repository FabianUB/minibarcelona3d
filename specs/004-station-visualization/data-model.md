# Data Model: Station Visualization

**Feature**: 004-station-visualization
**Date**: 2025-11-14
**Status**: Complete

## Overview

This document defines the data structures and state management for the station visualization feature. Most types already exist in the codebase; this document clarifies extensions and new types needed for station interaction.

---

## Existing Types (Reference)

### Station (from apps/web/src/types/rodalies.ts)

```typescript
export interface Station {
  id: string;
  name: string;
  code: string | null;
  lines: string[];              // Array of line IDs (e.g., ["R1", "R2"])
  geometry: PointGeometry;       // GeoJSON Point
}

export interface PointGeometry {
  type: 'Point';
  coordinates: LngLat;           // [lng, lat]
}

export type LngLat = [number, number];
```

**Source**: Loaded from `public/rodalies_data/Station.geojson`

**Validation Rules**:
- `id`: Non-empty string, unique across all stations
- `name`: Non-empty string
- `code`: Nullable (some stations don't have codes)
- `lines`: Non-empty array (minimum 1 line)
- `coordinates`: Valid [lng, lat] within Barcelona region bounds

**Relationships**:
- `lines[]` references `RodaliesLine.id`
- Each line provides `brand_color` for visual styling

---

## New State Types

### MapUIState Extensions

```typescript
export interface MapUIState {
  // Existing fields
  selectedLineIds: string[];
  highlightMode: MapHighlightMode;
  isHighContrast: boolean;
  activePanel: ActivePanel;

  // NEW: Station-related state
  selectedStationId: string | null;
  stationLoadError: string | null;
}
```

**Field Descriptions**:
- `selectedStationId`: ID of currently selected station (null = no selection)
  - Set by: User click on station marker
  - Cleared by: Panel close, selecting another station, clicking map background

- `stationLoadError`: Error message from failed station data load (null = no error)
  - Set by: `loadStations()` failure after retry exhaustion
  - Cleared by: Successful retry or user dismiss

**State Transitions**:
```
Initial: { selectedStationId: null, stationLoadError: null }
  ↓ Click station "79101"
{ selectedStationId: "79101", stationLoadError: null }
  ↓ Close panel
{ selectedStationId: null, stationLoadError: null }
  ↓ Load failure
{ selectedStationId: null, stationLoadError: "Failed to fetch station data" }
  ↓ Successful retry
{ selectedStationId: null, stationLoadError: null }
```

---

### MapActions Extensions

```typescript
export interface MapActions {
  // Existing actions...

  // NEW: Station-related actions
  selectStation(stationId: string | null): void;
  retryStationLoad(): void;
}
```

**Action Specifications**:

#### `selectStation(stationId)`
- **Input**: `stationId: string | null`
- **Behavior**:
  - If `stationId` is non-null: Set `selectedStationId`, open station panel (`activePanel = 'stationInfo'`)
  - If `stationId` is null: Clear selection, close panel (if station panel was active)
  - Cancel any pending station data loads (for rapid click handling - see FR-016)
- **Side Effects**: Updates `selectedStationId` and `activePanel` in state

#### `retryStationLoad()`
- **Input**: None
- **Behavior**:
  - Invalidate cached station data in dataLoader
  - Re-trigger `loadStations()` with exponential backoff
  - Clear `stationLoadError` if successful, update with new error if failed
- **Side Effects**: Async data reload, potential state update

---

## Computed/Derived Data

### StationWithMetadata

Used internally for rendering; augments base Station with computed properties.

```typescript
interface StationWithMetadata extends Station {
  // Computed fields
  isMultiLine: boolean;              // true if lines.length > 1
  dominantLineColor: string;         // brand_color of lines[0]
  lineCount: number;                 // lines.length
  displayName: string;               // name (truncated if >30 chars for tooltip)

  // Positioning
  offsetX?: number;                  // Pixel offset from true position (radial algorithm)
  offsetY?: number;
}
```

**Computation Logic**:
```typescript
function enrichStation(
  station: Station,
  linesMap: Map<string, RodaliesLine>
): StationWithMetadata {
  const firstLine = linesMap.get(station.lines[0]);

  return {
    ...station,
    isMultiLine: station.lines.length > 1,
    dominantLineColor: firstLine?.brand_color || '#CCCCCC',
    lineCount: station.lines.length,
    displayName: station.name.length > 30
      ? station.name.substring(0, 27) + '...'
      : station.name
  };
}
```

**Usage**: Passed to Mapbox GL layer as GeoJSON feature properties

---

## Error States

### StationLoadError

```typescript
interface StationLoadError {
  message: string;                   // User-facing error message
  code: 'NETWORK_ERROR' | 'PARSE_ERROR' | 'NOT_FOUND';
  retryCount: number;                // Number of retries attempted
  timestamp: number;                 // When error occurred (Date.now())
}
```

**Error Scenarios**:
1. **NETWORK_ERROR**: `fetch()` failed (network unreachable, 500 server error)
   - Message: "Unable to load station data. Check your connection."
2. **PARSE_ERROR**: JSON parsing failed (corrupted data)
   - Message: "Station data is corrupted. Please report this issue."
3. **NOT_FOUND**: Station.geojson missing from manifest
   - Message: "Station data not found. Please reload the page."

**Validation**: Error state stored as simple string in `MapUIState.stationLoadError` for simplicity; full `StationLoadError` object can be introduced later if richer error handling needed.

---

## Data Flow Diagram

```
User Action          State Update              Data Load              UI Render
───────────          ────────────              ─────────              ─────────
Click station
    │
    ├──> selectStation("79101")
    │        │
    │        ├──> selectedStationId = "79101"
    │        └──> activePanel = 'stationInfo'
    │                  │
    │                  └──> StationInfoPanel renders
    │                           │
    │                           └──> Displays station name, code, lines
    │
Close panel
    │
    └──> selectStation(null)
             │
             └──> selectedStationId = null
                       │
                       └──> StationInfoPanel unmounts

Page Load
    │
    └──> useEffect(() => loadStations())
             │
             ├──> Success: Cache stations in dataLoader
             │       │
             │       └──> StationLayer renders markers
             │
             └──> Failure: retryStationLoad() after 2s/4s/8s
                     │
                     ├──> Success after retry: Cache stations
                     │
                     └──> Failure after 3 retries:
                             │
                             └──> stationLoadError = "Failed to load..."
                                     │
                                     └──> Error banner renders with retry button
```

---

## Validation Rules Summary

| Entity | Field | Rule | Error Handling |
|--------|-------|------|----------------|
| Station | id | Non-empty, unique | Skip invalid stations, log warning |
| Station | name | Non-empty | Use fallback "Unknown Station" |
| Station | code | Nullable | Display "N/A" in panel if null |
| Station | lines | Non-empty array, valid line IDs | Filter invalid line refs, require ≥1 valid |
| Station | coordinates | Within bounds `[0.24, 40.39] - [3.36, 42.65]` | Skip out-of-bounds stations |
| MapUIState | selectedStationId | Must exist in loaded stations or null | Clear selection if station not found |

---

## Performance Considerations

### Data Volume
- **Station count**: ~200 stations in current dataset
- **GeoJSON size**: ~50KB (Station.geojson)
- **Memory footprint**: ~200 objects × 200 bytes = 40KB in-memory

### Caching Strategy
- **dataLoader cache**: Singleton promise-based cache, loaded once per session
- **Cache invalidation**: Only on explicit retry or page reload
- **No expiration**: Static data doesn't change during session

### Rendering Optimization
- **Mapbox GL source**: Single GeoJSON source for all stations
- **Layer count**: 2-3 layers (single-line circles, multi-line outer/inner circles)
- **Data-driven styling**: GPU-side filtering, no JavaScript per-marker logic
- **Zoom-based culling**: Mapbox GL automatically culls off-screen features

---

## Future Extensions (Out of Scope)

- **Station search index**: Full-text search on station names
- **Favorite stations**: User-persisted station bookmarks
- **Real-time occupancy**: Train crowding data per station
- **Accessibility info**: Wheelchair access, elevator status
- **Transfer connections**: Metro/bus connections at stations

---

**Next**: Phase 1 - Contracts (API/Component interfaces)
