# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**MiniBarcelona3D** is a 3D interactive map visualization for the Barcelona public transport network. It displays real-time positions of Rodalies (commuter rail), Metro, Bus, Tram, and FGC trains/vehicles. The project uses a monorepo structure with separate frontend (React + Mapbox GL) and backend (Go) applications.

## Repository Structure

```
apps/
  web/           # React 19 + TypeScript 5 frontend with Vite
  api/           # Go 1.25.3 backend API (minimal, for future use)
specs/           # Feature specifications using .specify workflow
  001-show-rodalies-map/  # Current feature implementation
.specify/        # Specification templates and tooling
docs/            # Project documentation
```

## Essential Development Commands

### Frontend (apps/web)

All commands should be run from the `apps/web` directory unless otherwise noted.

**Development:**
```bash
cd apps/web
npm run dev              # Start dev server on http://localhost:5173
```

**Testing:**
```bash
npm test                 # Run unit tests with Vitest
npm run test -- --run    # Run tests once without watch mode
npm run test:e2e         # Run all Playwright E2E tests across browsers
npm run test:e2e -- map-default-view.spec.ts  # Run single E2E spec
npm run test:e2e:ci      # Run E2E tests in CI mode
npm run test:accessibility  # Run accessibility tests (@axe tagged)
```

**Building & Analysis:**
```bash
npm run build            # TypeScript compile + Vite build
npm run lint             # ESLint with TypeScript rules
npm run analyze-bundle   # Build with bundle size visualization
npm run preview          # Preview production build locally
```

### Backend (apps/api)

```bash
cd apps/api
go test ./...            # Run Go tests (regression smoke tests)
```

### Docker Development

```bash
docker-compose up        # Start both web and api services
```

## Architecture

### Frontend State Management

The application uses a **Context + Reducer pattern** for global map state instead of external state management libraries:

- **MapStateProvider** (`apps/web/src/state/map/MapStateProvider.tsx`): Central reducer-based state container
- **Contexts**: Three separate contexts for state, actions, and selectors
  - `MapStateContext`: Read-only state (viewport, UI state, map instance)
  - `MapActionsContext`: State mutation actions
  - `MapHighlightSelectorsContext`: Derived state for line highlighting
- **Hooks**: `useMapState()`, `useMapActions()`, `useMapHighlightSelectors()`, `useMapStore()`

Key state domains:
- **Viewport state**: Camera position, zoom, bounds, padding
- **UI state**: Selected line, highlight mode (none/highlight/isolate), high contrast, legend visibility
- **Map instance**: Mapbox GL Map reference and load status

### Data Loading

Rodalies data is loaded from static JSON/GeoJSON files in `apps/web/public/rodalies_data/`:
- **manifest.json**: Central registry of all data files with paths and checksums
- **Data loader** (`apps/web/src/lib/rodalies/dataLoader.ts`): Caching layer for all data fetching
- All loaders return promises and cache results to prevent duplicate fetches

Data types:
- `RodaliesManifest`: Registry of available data files
- `RodaliesLine`: Line metadata (id, name, colors, patterns)
- `Station`: Station points with line associations
- `LineGeometryCollection`: GeoJSON FeatureCollections for map rendering
- `MapViewport`: Camera configuration with bounds and padding
- `MapUIState`: UI state that can be persisted/restored

### Feature Organization

Features are organized by domain in `apps/web/src/features/`:
- `map/`: Mapbox canvas, controls, viewport management
- `legend/`: Line legend UI and interaction (not yet implemented)
- `trains/`: Real-time train visualization and info panels

Shared code:
- `lib/`: Reusable utilities (data loaders, geometry processing, etc.)
- `state/`: Global state providers
- `types/`: TypeScript type definitions
- `styles/`: CSS modules/global styles

### Type System

All domain types are defined in `apps/web/src/types/rodalies.ts`:
- GeoJSON types are explicitly defined (not imported from external libs)
- Strict typing for coordinates: `LngLat = [number, number]`
- Feature/FeatureCollection types are generic and reusable
- Pattern types use string aliases for better documentation

## Environment Variables

Required environment variables (see `.env.example`):

**Frontend:**
- `MAPBOX_TOKEN`: Mapbox API token for map tiles (required)
- `VITE_API_BASE`: API base URL (default: `/api`)
- `VITE_APP_NAME`: Application name

**Backend:**
- `PORT`: API server port (default: 8080)
- `ALLOWED_ORIGINS`: CORS allowed origins
- `DATABASE_URL`: PostgreSQL connection string (future use)

## Testing Strategy

Three-tier testing approach (see `docs/TESTS.md`):

1. **Unit & Component Tests** (Vitest + Testing Library)
   - Fast feedback on data loaders, reducers, hooks
   - Run individual tests: `npm test -- legend-store`

2. **End-to-End Tests** (Playwright)
   - Real browser testing across Chromium, Firefox, WebKit
   - Tests located in `apps/web/e2e/*.spec.ts`
   - Separate accessibility project with `@axe` tag filtering

3. **Static Analysis** (ESLint)
   - TypeScript-aware linting with React-specific rules

## Key Files to Understand

**Core Application:**
- `apps/web/src/App.tsx`: Application root with MapStateProvider
- `apps/web/src/state/map/MapStateProvider.tsx`: Core state management reducer
- `apps/web/src/lib/rodalies/dataLoader.ts`: Data fetching and caching layer
- `apps/web/src/types/rodalies.ts`: Complete type system
- `apps/web/vite.config.ts`: Vite configuration with test setup
- `apps/web/playwright.config.ts`: E2E test configuration with multi-browser matrix

**Station Features:**
- `apps/web/src/features/stations/StationLayer.tsx`: Station markers on map (teardrop symbols with zoom-responsive sizing)
- `apps/web/src/features/stations/hooks/useStationMarkers.ts`: Data loading and GeoJSON enrichment with radial offsets
- `apps/web/src/lib/stations/markerPositioning.ts`: Radial offset calculation for overlapping stations
- `apps/web/src/lib/stations/markerStyles.ts`: Mapbox GL paint properties for station markers
- `apps/web/src/features/stations/StationInfoPanel*.tsx`: Station details panels (desktop/mobile with ShadCN UI)
- `apps/web/src/features/stations/hooks/useStationHover.ts`: Hover tooltip functionality (currently disabled)
- Visualization: Teardrop markers at low zoom (<15), same markers with station names at high zoom (≥15)
- State integration: Uses MapStateProvider for selectedStationId and highlight/isolate modes

**Train Features:**
- `apps/web/src/features/trains/TrainLayer3D.tsx`: 3D train rendering with Three.js via Mapbox Custom Layer API
- `apps/web/src/lib/trains/trainMeshManager.ts`: Manages train mesh lifecycle, positioning, and animations
- `apps/web/src/lib/trains/scaleManager.ts`: Zoom-responsive train scaling with discrete buckets and caching
- `apps/web/src/lib/trains/outlineManager.ts`: Hover outline creation using BackSide rendering technique
- `apps/web/src/lib/trains/geometry.ts`: Railway line snapping and bearing calculations
- `apps/web/src/features/trains/TrainInfoPanel*.tsx`: Train details panels (desktop/mobile)
- `apps/web/src/features/trains/TrainDebugPanel.tsx`: Debug panel for train offset and zoom info
- `apps/web/src/state/trains/`: Train-specific state management (Zustand)
- `apps/web/src/lib/api/trains.ts`: API client for train data

**Backend API:**
- `apps/api/handlers/trains.go`: HTTP handlers for train endpoints
- `apps/api/repository/postgres.go`: Database queries with connection pooling
- `apps/api/models/trains.go`: Go data models for train entities

## Development Workflow

The project uses the `.specify` workflow for feature development:
- Feature specs in `specs/<feature-id>/`
- Each spec has `spec.md`, `plan.md`, `tasks.md`, `quickstart.md`
- Slash commands available: `/speckit.specify`, `/speckit.plan`, `/speckit.tasks`, etc.

## Common Patterns

**Adding a new map feature:**
1. Define types in `apps/web/src/types/rodalies.ts`
2. Add state to MapState/MapActions in `apps/web/src/state/map/types.ts`
3. Add reducer case in `apps/web/src/state/map/MapStateProvider.tsx`
4. Create feature component in `apps/web/src/features/<feature>/`
5. Write unit tests for state logic
6. Write E2E tests for user journeys

**Data loading pattern:**
```typescript
// Always use the data loader cache
const viewport = await loadMapViewport();
const stations = await loadStationList();
```

**Accessing map state:**
```typescript
// In React components
const state = useMapState();
const actions = useMapActions();
const { isLineHighlighted } = useMapHighlightSelectors();

// Or get all at once
const [state, actions, selectors] = useMapStore();
```

**Train state management pattern:**
```typescript
// Train-specific state (separate from map state)
const { selectedTrain, isPanelOpen } = useTrainState();
const { selectTrain, clearSelection } = useTrainActions();

// Selecting a train
const handleTrainClick = async (vehicleKey: string) => {
  const trainData = await fetchTrainByKey(vehicleKey);
  selectTrain(trainData);
  setActivePanel('trainInfo');
};
```

**Station state management pattern:**
```typescript
// Station selection uses MapStateProvider (unlike trains)
const { ui } = useMapState();
const { selectStation } = useMapActions();

// Selecting a station
const handleStationClick = (event: mapboxgl.MapLayerMouseEvent) => {
  const feature = event.features?.[0];
  if (feature?.properties) {
    const stationId = feature.properties.id;
    selectStation(stationId);
    // Panel opens automatically via selectedStationId state
  }
};

// Station data loading with graceful fallbacks
const stationLines = useMemo(() => {
  const map = new Map(lines.map((line) => [line.id, line]));
  const orderedLines = station?.lines
    .map((lineId) => map.get(lineId) ?? null)
    .filter(Boolean) as RodaliesLine[]; // Filters out unloaded lines
  return orderedLines.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}, [station, lines]);
```

**3D Train Rendering with Three.js:**
```typescript
// TrainLayer3D uses Mapbox Custom Layer API
// Task reference pattern for tracking implementation
/**
 * Effect: Update train meshes when data changes
 * Tasks: T046 - Create mesh instances
 *        T047 - Apply bearing-based rotation
 */
useEffect(() => {
  meshManagerRef.current.updateTrainMeshes(trains, previousPositions, {
    currentPolledAtMs,
    previousPolledAtMs,
    receivedAtMs,
  });
}, [trains, modelsLoaded, stationsLoaded]);

// Performance monitoring is built-in
// Logs FPS and frame times every 5 seconds
// Warns if FPS < 30 or frame time > 33ms
```

**Railway geometry snapping:**
```typescript
// Snap train positions to railway lines for realistic movement
const preprocessed = preprocessRailwayLine(feature.geometry);
const snapState = snapToRailwayLine(
  trainPosition,
  nextStopPosition,
  preprocessedLine
);

// Apply bearing from snapped position
meshManager.applyRailwayBearing(mesh, snapState.bearing, reversed);
```

**API data fetching with error handling:**
```typescript
// Use built-in retry mechanism with exponential backoff
const fetchTrains = async () => {
  try {
    const response = await fetchTrainPositions();
    setTrains(response.positions);
    setError(null);
    setRetryCount(0);
  } catch (err) {
    setError(err.message);
    // Exponential backoff: 2s, 4s, 8s, 16s, 32s (max 5 retries)
    const retryDelayMs = Math.min(2000 * Math.pow(2, retryCount), 32000);
    setTimeout(() => fetchTrains(), retryDelayMs);
  }
};
```

**Stale data detection:**
```typescript
// Check if data is older than threshold (60s)
const dataAge = Date.now() - polledAtTimestamp;
const isStale = dataAge > 60000;

// Apply visual indicator (reduce opacity by 50%)
const opacity = isStale ? baseOpacity * 0.5 : baseOpacity;
meshManager.setTrainOpacities(trainOpacities);
```

**Zoom-responsive train scaling:**
```typescript
// Use ScaleManager for discrete zoom buckets with caching
import { ScaleManager } from '../lib/trains/scaleManager';

const scaleManager = new ScaleManager({
  minHeightPx: 15,
  maxHeightPx: 50,
  targetHeightPx: 30,
});

// Compute scale on zoom change
const zoomScale = scaleManager.computeScale(currentZoom);
mesh.scale.set(baseScale * zoomScale, baseScale * zoomScale, baseScale * zoomScale);

// Monitor cache performance
const stats = scaleManager.getCacheStats();
console.log(`Cache hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
```

**Train hover outlines with BackSide rendering:**
```typescript
// Build line color map for hover outlines
import { buildLineColorMap, createOutlineMesh } from '../lib/trains/outlineManager';

const lines = await loadRodaliesLines();
const colorMap = buildLineColorMap(lines, 'CCCCCC');

// Create outline lazily on first hover
const lineColor = colorMap.get(train.lineCode) || colorMap.get('__FALLBACK__');
const outline = createOutlineMesh(trainModel, lineColor, 1.12, 0.95);
trainMesh.add(outline);

// Toggle visibility on hover
outline.visible = true; // Show on hover
outline.visible = false; // Hide on leave
```

**Railway line rendering (Mini Tokyo 3D approach):**
```typescript
// Single layer for all lines - natural GPS positions, no artificial offsets
map.addLayer({
  id: 'rodalies-lines',
  type: 'line',
  source: 'rodalies-lines',
  layout: {
    'line-join': 'round',
    'line-cap': 'round',
  },
  paint: {
    'line-color': ['get', 'brand_color'],
    'line-width': [
      'interpolate',
      ['exponential', 1.5],
      ['zoom'],
      8, 1,
      22, 12
    ],
    'line-emissive-strength': 1,
  },
});

// Note: Proximity-based rendering with separate layers was attempted but
// caused severe performance issues (567 layers). The simple approach above
// is preferred for performance and maintainability.
```

## Coding Standards

### Comments and Code Clarity

**Good comments should explain why, not what.**

- The code should make it clear exactly what you're doing, it should be as readable as possible
- Comments should explain why you're doing something a certain way
- Only use them when absolutely necessary

**Examples:**

```typescript
// BAD: Comment explains what (code already shows this)
// Set the user's name to "John"
const name = "John";

// GOOD: Comment explains why (provides context)
// Default to "John" for demo accounts created before user profile migration
const name = "John";
```

```go
// BAD: Comment restates the obvious
// Create a new train repository
repo := repository.NewTrainRepository(databaseURL)

// GOOD: Comment explains why we use pointers
// Use *float64 for nullable coordinates - some trains don't report GPS
type Train struct {
    Latitude  *float64  `db:"latitude"`
    Longitude *float64  `db:"longitude"`
}
```

```typescript
// BAD: Comment describes implementation
// Loop through all trains and filter by route
const routeTrains = trains.filter(t => t.routeId === selectedRoute);

// GOOD: Comment explains business logic reasoning
// Only show trains on selected route to reduce visual clutter on map
const routeTrains = trains.filter(t => t.routeId === selectedRoute);
```

## Active Technologies
- PostgreSQL database with `rt_rodalies_vehicle_current` table (documented in `/docs/DATABASE_SCHEMA.md`) (002-realtime-train-tracking)
- TypeScript 5.9.3 (React 19.1.1 frontend) + Three.js 0.180.0, Mapbox GL JS 3.4.0, Vite 7.1.7 (003-train-line-colors-zoom)
- Static JSON/GeoJSON files in `apps/web/public/rodalies_data/` (003-train-line-colors-zoom)
- TypeScript 5.9.3, React 19.1.1 + Mapbox GL JS 3.4.0, Radix UI (dialogs, popovers), Tailwind CSS 4.1.16, Vitest 2.1.9, Playwright 1.48.2 (004-station-visualization)
- Static GeoJSON files (Station.geojson), client-side caching via existing dataLoader (004-station-visualization)

## Recent Changes
- 004-station-visualization: Added interactive station visualization with 200+ station markers displayed as teardrop symbols with zoom-responsive sizing. Features include: click-to-view-details panels (desktop/mobile responsive with ShadCN Dialog), radial offset positioning for overlapping stations at complex interchanges, highlight/isolate mode integration via MapStateProvider, graceful error handling for missing station codes and unloaded lines, and hover tooltips (currently disabled). Station info panels display station name, code (when available), and serving lines with color-coded badges.
- 003-train-line-colors-zoom: Added zoom-responsive train scaling (ScaleManager), hover outlines with BackSide rendering (outlineManager), and debug panel for train visualization. Simplified railway line rendering to Mini Tokyo 3D approach (single layer) after removing proximity-based system due to performance issues (567 layers)
- 002-realtime-train-tracking: Added PostgreSQL database with `rt_rodalies_vehicle_current` table (documented in `/docs/DATABASE_SCHEMA.md`)
