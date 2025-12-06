# Quickstart: Station Visualization

**Feature**: 004-station-visualization
**Audience**: Developers implementing this feature
**Prerequisite**: Read [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md)

## Overview

This quickstart provides a step-by-step implementation guide for adding interactive station markers to the Rodalies map.

---

## Phase 1: Data Loading & State Management

### Step 1.1: Extend MapStateProvider

**File**: `apps/web/src/state/map/types.ts`

Add station-related state to `MapUIState`:

```typescript
export interface MapUIState {
  // ... existing fields
  selectedStationId: string | null;
  stationLoadError: string | null;
}
```

Add station-related actions to `MapActions`:

```typescript
export interface MapActions {
  // ... existing actions
  selectStation(stationId: string | null): void;
  retryStationLoad(): void;
}
```

**Test**: Run `npm test -- MapStateProvider.test` (add test cases for new actions)

---

### Step 1.2: Implement Station Reducer Cases

**File**: `apps/web/src/state/map/MapStateProvider.tsx`

Add reducer cases:

```typescript
case 'SELECT_STATION':
  return {
    ...state,
    ui: {
      ...state.ui,
      selectedStationId: action.payload,
      activePanel: action.payload ? 'stationInfo' : state.ui.activePanel,
    },
  };

case 'SET_STATION_LOAD_ERROR':
  return {
    ...state,
    ui: {
      ...state.ui,
      stationLoadError: action.payload,
    },
  };
```

Add action implementations:

```typescript
const selectStation = useCallback((stationId: string | null) => {
  dispatch({ type: 'SELECT_STATION', payload: stationId });
}, []);

const retryStationLoad = useCallback(() => {
  // Invalidate cache and reload
  stationCollectionPromise = null; // Reset dataLoader cache
  dispatch({ type: 'SET_STATION_LOAD_ERROR', payload: null });
  loadStations().catch(err => {
    dispatch({ type: 'SET_STATION_LOAD_ERROR', payload: err.message });
  });
}, []);
```

**Test**: Verify actions update state correctly

---

## Phase 2: Utility Functions

### Step 2.1: Radial Offset Positioning

**File**: `apps/web/src/lib/stations/markerPositioning.ts`

```typescript
import type { Station, LngLat } from '../../types/rodalies';
import type { Map as MapboxMap } from 'mapbox-gl';

interface StationOffset {
  stationId: string;
  offsetX: number;
  offsetY: number;
}

const OVERLAP_THRESHOLD_PX = 20;
const OFFSET_RADIUS_BASE = 10;

export function calculateRadialOffsets(
  stations: Station[],
  map: MapboxMap
): StationOffset[] {
  // 1. Project all stations to screen pixels
  const projected = stations.map(s => ({
    station: s,
    point: map.project(s.geometry.coordinates as [number, number]),
  }));

  // 2. Detect overlapping groups
  const groups = clusterByProximity(projected, OVERLAP_THRESHOLD_PX);

  // 3. Compute radial offsets for each group
  return groups.flatMap(group => {
    if (group.length === 1) {
      return [{ stationId: group[0].station.id, offsetX: 0, offsetY: 0 }];
    }

    const radius = OFFSET_RADIUS_BASE + group.length * 2;
    return group.map((item, index) => {
      const angle = (index / group.length) * 2 * Math.PI;
      return {
        stationId: item.station.id,
        offsetX: Math.cos(angle) * radius,
        offsetY: Math.sin(angle) * radius,
      };
    });
  });
}

function clusterByProximity(
  projected: Array<{ station: Station; point: { x: number; y: number } }>,
  threshold: number
): Array<Array<{ station: Station; point: { x: number; y: number } }>> {
  const clusters: Array<Array<typeof projected[0]>> = [];
  const visited = new Set<string>();

  projected.forEach(item => {
    if (visited.has(item.station.id)) return;

    const cluster = [item];
    visited.add(item.station.id);

    projected.forEach(other => {
      if (visited.has(other.station.id)) return;
      const dx = item.point.x - other.point.x;
      const dy = item.point.y - other.point.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < threshold) {
        cluster.push(other);
        visited.add(other.station.id);
      }
    });

    clusters.push(cluster);
  });

  return clusters;
}
```

**Test**: `apps/web/src/lib/stations/markerPositioning.test.ts`
- Verify offsets are computed for overlapping stations
- Verify single stations get (0, 0) offset
- Verify radial distribution (angles are evenly spaced)

---

### Step 2.2: Marker Styles

**File**: `apps/web/src/lib/stations/markerStyles.ts`

```typescript
export function getStationMarkerStyles(
  isHighlighted: boolean,
  isDimmed: boolean
) {
  return {
    'circle-radius': [
      'interpolate',
      ['exponential', 1.5],
      ['zoom'],
      8, ['case', ['get', 'isMultiLine'], 5, 4],
      16, ['case', ['get', 'isMultiLine'], 14, 12],
    ],
    'circle-color': ['get', 'dominantLineColor'],
    'circle-opacity': isDimmed ? 0.3 : 1.0,
    'circle-stroke-width': ['case', ['get', 'isMultiLine'], 2, 1],
    'circle-stroke-color': isHighlighted ? '#FFD700' : '#FFFFFF',
  };
}

export function getMultiLineInnerCircleStyles() {
  return {
    'circle-radius': [
      'interpolate',
      ['exponential', 1.5],
      ['zoom'],
      8, 3,
      16, 9,
    ],
    'circle-color': '#FFFFFF',
    'circle-stroke-width': 1,
    'circle-stroke-color': ['get', 'dominantLineColor'],
  };
}
```

**Test**: Visual verification (or snapshot testing)

---

## Phase 3: Station Layer Component

### Step 3.1: Create StationLayer

**File**: `apps/web/src/features/stations/StationLayer.tsx`

```typescript
import { useEffect, useState } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { loadStations, loadRodaliesLines } from '../../lib/rodalies/dataLoader';
import { calculateRadialOffsets } from '../../lib/stations/markerPositioning';
import { getStationMarkerStyles, getMultiLineInnerCircleStyles } from '../../lib/stations/markerStyles';
import type { Station, RodaliesLine } from '../../types/rodalies';

interface StationLayerProps {
  map: MapboxMap;
  highlightedLineIds: string[];
  highlightMode: 'none' | 'highlight' | 'isolate';
  onStationClick: (stationId: string) => void;
  onStationHover?: (stationId: string | null) => void;
}

const SOURCE_ID = 'stations-source';
const LAYER_ID_SINGLE = 'stations-circles-single';
const LAYER_ID_MULTI_OUTER = 'stations-circles-multi-outer';
const LAYER_ID_MULTI_INNER = 'stations-circles-multi-inner';

export function StationLayer({
  map,
  highlightedLineIds,
  highlightMode,
  onStationClick,
  onStationHover,
}: StationLayerProps) {
  const [stations, setStations] = useState<Station[]>([]);
  const [lines, setLines] = useState<RodaliesLine[]>([]);

  // Load station data on mount
  useEffect(() => {
    Promise.all([loadStations(), loadRodaliesLines()])
      .then(([stationData, lineData]) => {
        setStations(stationData.features.map(f => ({
          id: f.properties.id,
          name: f.properties.name,
          code: f.properties.code,
          lines: f.properties.lines,
          geometry: f.geometry,
        })));
        setLines(lineData);
      })
      .catch(err => console.error('Failed to load station data:', err));
  }, []);

  // Add Mapbox source and layers
  useEffect(() => {
    if (!map || stations.length === 0) return;

    // Compute offsets
    const offsets = calculateRadialOffsets(stations, map);
    const offsetMap = new Map(offsets.map(o => [o.stationId, o]));

    // Enrich station data
    const lineMap = new Map(lines.map(l => [l.id, l]));
    const geoJSON = {
      type: 'FeatureCollection' as const,
      features: stations.map(s => {
        const offset = offsetMap.get(s.id) || { offsetX: 0, offsetY: 0 };
        const firstLine = lineMap.get(s.lines[0]);
        return {
          type: 'Feature' as const,
          id: s.id,
          properties: {
            ...s,
            isMultiLine: s.lines.length > 1,
            dominantLineColor: firstLine?.brand_color || '#CCCCCC',
            lineCount: s.lines.length,
            offsetX: offset.offsetX,
            offsetY: offset.offsetY,
          },
          geometry: s.geometry,
        };
      }),
    };

    // Add source
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: geoJSON,
    });

    // Add layers
    const isDimmed = highlightMode !== 'none' && highlightedLineIds.length > 0;
    const styles = getStationMarkerStyles(false, isDimmed);

    // Single-line stations
    map.addLayer({
      id: LAYER_ID_SINGLE,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['!', ['get', 'isMultiLine']],
      paint: styles,
    });

    // Multi-line stations (outer circle)
    map.addLayer({
      id: LAYER_ID_MULTI_OUTER,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['get', 'isMultiLine'],
      paint: styles,
    });

    // Multi-line stations (inner circle)
    map.addLayer({
      id: LAYER_ID_MULTI_INNER,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['get', 'isMultiLine'],
      paint: getMultiLineInnerCircleStyles(),
    });

    // Click handler
    const handleClick = (e: any) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [LAYER_ID_SINGLE, LAYER_ID_MULTI_OUTER],
      });
      if (features.length > 0) {
        onStationClick(features[0].properties.id);
      }
    };
    map.on('click', LAYER_ID_SINGLE, handleClick);
    map.on('click', LAYER_ID_MULTI_OUTER, handleClick);

    // Cleanup
    return () => {
      map.off('click', LAYER_ID_SINGLE, handleClick);
      map.off('click', LAYER_ID_MULTI_OUTER, handleClick);
      if (map.getLayer(LAYER_ID_MULTI_INNER)) map.removeLayer(LAYER_ID_MULTI_INNER);
      if (map.getLayer(LAYER_ID_MULTI_OUTER)) map.removeLayer(LAYER_ID_MULTI_OUTER);
      if (map.getLayer(LAYER_ID_SINGLE)) map.removeLayer(LAYER_ID_SINGLE);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [map, stations, lines, highlightedLineIds, highlightMode, onStationClick]);

  return null; // No DOM rendering
}
```

**Test**: E2E test that markers appear on map

---

## Phase 4: Station Info Panel

### Step 4.1: Create Panel Components

**File**: `apps/web/src/features/stations/StationInfoPanel.tsx`

```typescript
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { StationInfoPanelDesktop } from './StationInfoPanelDesktop';
import { StationInfoPanelMobile } from './StationInfoPanelMobile';
import type { Station, RodaliesLine } from '../../types/rodalies';

interface StationInfoPanelProps {
  station: Station | null;
  lines: RodaliesLine[];
  isOpen: boolean;
  onClose: () => void;
}

export function StationInfoPanel(props: StationInfoPanelProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return isDesktop ? (
    <StationInfoPanelDesktop {...props} />
  ) : (
    <StationInfoPanelMobile {...props} />
  );
}
```

**File**: `apps/web/src/features/stations/StationInfoPanelDesktop.tsx`

```typescript
import * as Dialog from '@radix-ui/react-dialog';
import type { Station, RodaliesLine } from '../../types/rodalies';

interface Props {
  station: Station | null;
  lines: RodaliesLine[];
  isOpen: boolean;
  onClose: () => void;
}

export function StationInfoPanelDesktop({ station, lines, isOpen, onClose }: Props) {
  if (!station) return null;

  const lineMap = new Map(lines.map(l => [l.id, l]));
  const stationLines = station.lines.map(id => lineMap.get(id)).filter(Boolean);

  return (
    <Dialog.Root open={isOpen} onOpenChange={open => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/20" />
        <Dialog.Content
          className="fixed bottom-6 right-6 w-[360px] bg-white rounded-lg shadow-xl p-6"
          aria-describedby="station-info-description"
        >
          <div className="flex justify-between items-start mb-4">
            <Dialog.Title className="text-xl font-semibold">
              {station.name}
            </Dialog.Title>
            <Dialog.Close className="text-gray-500 hover:text-gray-700">
              ✕
            </Dialog.Close>
          </div>

          <div id="station-info-description">
            {station.code && (
              <p className="text-sm text-gray-600 mb-4">Code: {station.code}</p>
            )}

            <div>
              <h3 className="text-sm font-medium mb-2">Serving Lines</h3>
              <div className="flex flex-wrap gap-2">
                {stationLines.map(line => (
                  <div
                    key={line.id}
                    className="px-3 py-1 rounded-full text-sm font-medium"
                    style={{
                      backgroundColor: line.brand_color,
                      color: '#FFFFFF',
                    }}
                  >
                    {line.short_code}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

**File**: `apps/web/src/features/stations/StationInfoPanelMobile.tsx`

(Similar structure, but with bottom sheet positioning)

**Test**: Component test for panel rendering, line badge display

---

## Phase 5: Integration

### Step 5.1: Add to Map View

**File**: `apps/web/src/features/map/RodaliesMapView.tsx`

```typescript
import { StationLayer } from '../stations/StationLayer';
import { StationInfoPanel } from '../stations/StationInfoPanel';

export function RodaliesMapView() {
  const { ui, actions } = useMapStore();
  const [lines, setLines] = useState([]);

  // ... existing code

  return (
    <>
      {/* Existing map components */}

      {mapInstance && isMapLoaded && (
        <>
          <StationLayer
            map={mapInstance}
            highlightedLineIds={ui.selectedLineIds}
            highlightMode={ui.highlightMode}
            onStationClick={actions.selectStation}
          />

          <StationInfoPanel
            station={selectedStation} // Fetch from dataLoader based on ui.selectedStationId
            lines={lines}
            isOpen={ui.activePanel === 'stationInfo'}
            onClose={() => actions.selectStation(null)}
          />
        </>
      )}

      {ui.stationLoadError && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-yellow-100 border border-yellow-400 text-yellow-800 px-4 py-2 rounded">
          {ui.stationLoadError}
          <button onClick={actions.retryStationLoad} className="ml-4 underline">
            Retry
          </button>
        </div>
      )}
    </>
  );
}
```

---

## Phase 6: Testing

### Unit Tests
```bash
npm test -- markerPositioning.test
npm test -- markerStyles.test
npm test -- MapStateProvider.test
```

### Component Tests
```bash
npm test -- StationInfoPanel.test
npm test -- StationLayer.test
```

### E2E Tests
```bash
npm run test:e2e -- stations.spec
```

---

## Checklist

- [ ] MapStateProvider extended with station state/actions
- [ ] Radial offset positioning implemented
- [ ] Marker styles (single vs multi-line) implemented
- [ ] StationLayer component renders markers
- [ ] StationInfoPanel component displays details
- [ ] Error banner + retry functionality
- [ ] Unit tests passing
- [ ] Component tests passing
- [ ] E2E tests passing (P1, P2, P3 user stories)
- [ ] Visual QA: Markers appear, offsets work, panel opens/closes
- [ ] Performance: 30+ FPS with 200+ stations

---

## Common Issues

**Issue**: Markers not appearing
- **Fix**: Check console for dataLoader errors, verify Station.geojson exists

**Issue**: Overlapping markers still occur
- **Fix**: Verify `calculateRadialOffsets` is called on zoom change, check threshold value

**Issue**: Panel doesn't open
- **Fix**: Verify `selectStation` action is wired to click handler, check `activePanel` state

**Issue**: Hover tooltip not working
- **Fix**: Ensure `onStationHover` is only enabled on desktop (check media query)

---

**Next**: `/speckit.tasks` to generate implementation tasks
