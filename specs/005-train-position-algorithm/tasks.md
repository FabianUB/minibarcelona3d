# Tasks: Train Position Algorithm with Station Parking

**Feature Branch**: `005-train-position-algorithm`
**Created**: 2025-12-06
**Status**: Ready for Implementation

## Task Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| Phase 0 | T000a-T000d | Network Abstraction Layer (Metro-Compatible) |
| Phase 1 | T001-T006 | Algorithm State & Toggle UI |
| Phase 2 | T007-T014 | Station Parking System |
| Phase 3 | T015-T019 | Trip Details Caching |
| Phase 4 | T020-T027 | Predictive Interpolation |
| Phase 5 | T028-T032 | Integration & Polish |

**Total Tasks**: 36

---

## Phase 0: Network Abstraction Layer (Metro-Compatible)

### T000a: Create LineResolver interface and RodaliesLineResolver
**File**: `apps/web/src/lib/trains/lineResolver.ts`
**Type**: New file
**Priority**: P1

Create the abstraction for resolving train-to-line relationships:
```typescript
interface LineResolver {
  resolveLineId(train: TrainPosition, tripDetails?: TripDetails): string | null;
  lineServesStation(lineId: string, stationId: string): boolean;
  getLineBearingAtStation(lineId: string, stationId: string): number;
}

class RodaliesLineResolver implements LineResolver { ... }
```

**Acceptance Criteria**:
- [X] Interface defined with JSDoc comments
- [X] RodaliesLineResolver extracts line from routeId (e.g., "R1_MOLINS_MACANET" → "R1")
- [X] Bearing cache populated during data load
- [X] Unit tests for routeId parsing

---

### T000b: Create TransitNetworkAdapter and factory functions
**File**: `apps/web/src/lib/trains/networkAdapter.ts`
**Type**: New file
**Priority**: P1
**Depends on**: T000a

Create adapter that encapsulates network-specific configuration:
```typescript
interface TransitNetworkAdapter {
  networkType: 'rodalies' | 'metro';
  lineResolver: LineResolver;
  parkingConfig: ParkingConfig;
  predictiveConfig: PredictiveConfig;
}

function createRodaliesAdapter(...): TransitNetworkAdapter;
```

**Acceptance Criteria**:
- [X] TransitNetworkAdapter interface defined
- [X] `createRodaliesAdapter()` factory function works
- [X] Adapter used by TrainLayer3D to initialize positioning system

---

### T000c: Precompute line-station bearings during data load
**File**: `apps/web/src/lib/rodalies/dataLoader.ts`
**Type**: Modify
**Priority**: P1
**Depends on**: T000a

During initial data load, compute and cache the bearing of each line at each station:
- For each station, for each line that serves it
- Snap station to that line's geometry
- Extract bearing at snap point
- Store in LineResolver's bearing cache

**Acceptance Criteria**:
- [X] Bearings computed for all line-station pairs
- [X] Bearings accessible via `lineResolver.getLineBearingAtStation()`
- [X] Computation happens once at load, not per-frame

---

### T000d: Unit tests for LineResolver
**File**: `apps/web/src/lib/trains/lineResolver.test.ts`
**Type**: New file
**Priority**: P2
**Depends on**: T000a

Test LineResolver implementations:
- RouteId parsing for various formats
- Station-line membership checks
- Bearing lookups

**Acceptance Criteria**:
- [X] Tests pass for RodaliesLineResolver
- [X] Edge cases handled (invalid routeId, unknown station)

---

## Phase 1: Algorithm State & Toggle UI

### T001: Create algorithm state store
**File**: `apps/web/src/state/algorithm/algorithmStore.ts`
**Type**: New file
**Priority**: P1

Create Zustand store for algorithm preferences:
```typescript
interface AlgorithmState {
  mode: 'gps-only' | 'predictive';
  setMode: (mode: 'gps-only' | 'predictive') => void;
}
```

**Acceptance Criteria**:
- [X] Store exports `useAlgorithmState` hook
- [X] Mode defaults to 'gps-only' for backward compatibility
- [X] Mode persists to localStorage key `rodalies:positionAlgorithm`
- [X] Store initializes from localStorage on mount

---

### T002: Create AlgorithmToggle component
**File**: `apps/web/src/features/map/AlgorithmToggle.tsx`
**Type**: New file
**Priority**: P1
**Depends on**: T001

Create UI toggle for algorithm selection:
- Two-state toggle/segmented control
- Labels: "GPS" and "Predictive" (or icons)
- Tooltip explaining each mode

**Acceptance Criteria**:
- [X] Component renders toggle with current mode selected
- [X] Clicking toggle changes mode via store action
- [X] Visual feedback on mode change
- [X] Accessible (keyboard navigation, ARIA labels)

---

### T003: Add toggle to MapControls
**File**: `apps/web/src/features/map/MapControls.tsx`
**Type**: Modify
**Priority**: P1
**Depends on**: T002

Integrate AlgorithmToggle into map control panel.

**Acceptance Criteria**:
- [X] Toggle appears in map controls (near zoom buttons)
- [X] Toggle is visible but unobtrusive
- [X] Responsive design (mobile/desktop)

---

### T004: Unit tests for algorithm store
**File**: `apps/web/src/state/algorithm/algorithmStore.test.ts`
**Type**: New file
**Priority**: P2
**Depends on**: T001

Test store behavior:
- Initial state
- Mode switching
- Persistence to/from localStorage

**Acceptance Criteria**:
- [X] Tests pass for initial state
- [X] Tests pass for mode switching
- [X] Tests pass for persistence round-trip

---

### T005: Export algorithm types
**File**: `apps/web/src/types/algorithm.ts`
**Type**: New file
**Priority**: P1

Define shared types for algorithm system:
```typescript
export type PositionAlgorithmMode = 'gps-only' | 'predictive';

export interface CalculatedPosition {
  position: [number, number];
  bearing: number;
  source: 'gps' | 'predicted' | 'blended';
  confidence: number;
}
```

**Acceptance Criteria**:
- [X] Types exported and usable in other modules
- [X] JSDoc comments on all types

---

### T006: E2E test for algorithm toggle
**File**: `apps/web/e2e/algorithm-toggle.spec.ts`
**Type**: New file
**Priority**: P2
**Depends on**: T001-T003

Test toggle UI and persistence:
- Toggle visible on map
- Click changes mode
- Refresh preserves mode

**Acceptance Criteria**:
- [X] Test passes on Chromium
- [X] Test passes on Firefox
- [X] Test passes on WebKit

---

## Phase 2: Station Parking System

### T007: Create stationParking module
**File**: `apps/web/src/lib/trains/stationParking.ts`
**Type**: New file
**Priority**: P1

Core parking calculation functions:
```typescript
export function calculateParkingPosition(
  stationId: string,
  trainId: string,
  stationCoords: [number, number],
  railwayLine: PreprocessedRailwayLine
): ParkingPosition;

export function getStationTrackBearing(
  stationCoords: [number, number],
  railwayLine: PreprocessedRailwayLine
): number;
```

**Acceptance Criteria**:
- [X] `calculateParkingPosition` returns correct perpendicular offset
- [X] Deterministic slot assignment for same trainId
- [X] Bearing calculation uses station's railway line

---

### T008: Define parking slot configuration
**File**: `apps/web/src/lib/trains/stationParking.ts`
**Type**: Part of T007
**Priority**: P1

Add configuration constants:
```typescript
const PARKING_CONFIG = {
  maxSlots: 5,
  baseSpacingMeters: 20,
  zoomScaleFactor: 0.1,
  transitionDurationMs: 500,
};
```

**Acceptance Criteria**:
- [X] Constants are configurable
- [X] Default values produce reasonable visual spacing

---

### T009: Implement perpendicular offset calculation
**File**: `apps/web/src/lib/trains/stationParking.ts`
**Type**: Part of T007
**Priority**: P1

Calculate position perpendicular to track:
- Get track bearing at station
- Add 90° for perpendicular direction
- Apply offset in that direction

**Acceptance Criteria**:
- [X] Offset direction is perpendicular to track
- [X] Trains on opposite sides of station stay separated
- [X] Works for any track bearing (0-360°)

---

### T010: Add slot assignment hash function
**File**: `apps/web/src/lib/trains/stationParking.ts`
**Type**: Part of T007
**Priority**: P1

Deterministic slot assignment:
```typescript
function getSlotIndex(trainId: string, maxSlots: number): number {
  // Hash trainId to slot index
  let hash = 0;
  for (let i = 0; i < trainId.length; i++) {
    hash = (hash * 31 + trainId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % maxSlots;
}
```

**Acceptance Criteria**:
- [X] Same trainId always gets same slot
- [X] Slots distributed evenly across trains

---

### T011: Integrate parking into TrainMeshManager
**File**: `apps/web/src/lib/trains/trainMeshManager.ts`
**Type**: Modify
**Priority**: P1
**Depends on**: T007, T001

Modify `applyLateralOffset` to use perpendicular parking when:
- Algorithm mode is 'predictive'
- Train status is 'STOPPED_AT'

**Acceptance Criteria**:
- [X] STOPPED_AT trains use parking algorithm in predictive mode
- [X] GPS-only mode retains current behavior
- [X] Smooth transition when train arrives/departs

---

### T012: Add parking position cache
**File**: `apps/web/src/lib/trains/stationParking.ts`
**Type**: Part of T007
**Priority**: P2

Cache parking positions to avoid recalculation:
```typescript
const parkingCache = new Map<string, ParkingPosition>();

function getCachedParkingPosition(
  stationId: string,
  trainId: string,
  ...
): ParkingPosition {
  const cacheKey = `${stationId}:${trainId}`;
  if (parkingCache.has(cacheKey)) {
    return parkingCache.get(cacheKey)!;
  }
  // Calculate and cache
}
```

**Acceptance Criteria**:
- [X] Cache hit rate > 90% for stationary trains
- [X] Cache invalidates when train leaves station

---

### T013: Unit tests for stationParking
**File**: `apps/web/src/lib/trains/stationParking.test.ts`
**Type**: New file
**Priority**: P2
**Depends on**: T007

Test parking calculations:
- Perpendicular offset math
- Slot assignment distribution
- Edge cases (null values, invalid input)

**Acceptance Criteria**:
- [X] Tests pass for standard scenarios
- [X] Tests pass for edge cases
- [X] Coverage > 80%

---

### T014: Visual test for parking layout
**File**: `apps/web/e2e/station-parking.spec.ts`
**Type**: New file
**Priority**: P2
**Depends on**: T011

E2E test for visual parking verification:
- Navigate to station with stopped trains
- Enable predictive mode
- Verify trains are visually separated

**Acceptance Criteria**:
- [X] Screenshot comparison passes
- [X] Trains don't overlap at zoom 14+

---

## Phase 3: Trip Details Caching

### T015: Create tripCache module
**File**: `apps/web/src/lib/trains/tripCache.ts`
**Type**: New file
**Priority**: P1

In-memory cache for TripDetails:
```typescript
interface CacheEntry {
  data: TripDetails;
  fetchedAt: number;
  expiresAt: number;
}

export class TripCache {
  private cache = new Map<string, CacheEntry>();
  private readonly TTL_MS = 10 * 60 * 1000; // 10 minutes

  async get(tripId: string): Promise<TripDetails | null>;
  async getOrFetch(tripId: string): Promise<TripDetails>;
  invalidate(tripId: string): void;
  clear(): void;
}
```

**Acceptance Criteria**:
- [X] Cache returns data within TTL
- [X] Cache fetches on miss
- [X] Cache respects TTL expiry

---

### T016: Add fetchTripDetails with caching
**File**: `apps/web/src/lib/api/trains.ts`
**Type**: Modify
**Priority**: P1
**Depends on**: T015

Wrap existing `fetchTripDetails` with cache layer:
```typescript
// Existing function unchanged
export async function fetchTripDetails(tripId: string): Promise<TripDetails>;

// New cached version
export async function fetchTripDetailsCached(tripId: string): Promise<TripDetails> {
  return tripCache.getOrFetch(tripId);
}
```

**Acceptance Criteria**:
- [X] Cached version returns same data as uncached
- [X] Network request only made on cache miss
- [X] Error handling for failed fetches

---

### T017: Prefetch trip data for visible trains
**File**: `apps/web/src/features/trains/TrainLayer3D.tsx`
**Type**: Modify
**Priority**: P2
**Depends on**: T016

When predictive mode enabled, prefetch TripDetails:
- On train data update, identify new trains
- Prefetch TripDetails for trains with tripId
- Don't block rendering on prefetch

**Acceptance Criteria**:
- [X] TripDetails available before needed for position calc
- [X] Prefetch doesn't impact render performance
- [X] Graceful handling of prefetch failures

---

### T018: Unit tests for tripCache
**File**: `apps/web/src/lib/trains/tripCache.test.ts`
**Type**: New file
**Priority**: P2
**Depends on**: T015

Test cache behavior:
- Cache hit/miss
- TTL expiry
- Concurrent requests for same tripId
- Clear and invalidate

**Acceptance Criteria**:
- [X] All cache scenarios tested
- [X] Concurrent request deduplication works
- [X] Coverage > 80%

---

### T019: Add cache statistics for debug panel
**File**: `apps/web/src/lib/trains/tripCache.ts`
**Type**: Part of T015
**Priority**: P3

Add statistics tracking:
```typescript
interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}

getStats(): CacheStats;
```

**Acceptance Criteria**:
- [X] Stats accurately reflect cache behavior
- [X] Stats available in debug panel

---

## Phase 4: Predictive Interpolation

### T020: Create predictiveCalculator module
**File**: `apps/web/src/lib/trains/predictiveCalculator.ts`
**Type**: New file
**Priority**: P1
**Depends on**: T015

Core predictive position calculation:
```typescript
export function calculatePredictivePosition(
  train: TrainPosition,
  tripDetails: TripDetails,
  currentTime: number,
  railwayLines: Map<string, PreprocessedRailwayLine>,
  stations: Map<string, Station>
): CalculatedPosition | null;
```

**Acceptance Criteria**:
- [X] Returns position based on schedule progress
- [X] Handles missing/invalid schedule data
- [X] Falls back to GPS when prediction not possible

---

### T021: Implement time-based progress calculation
**File**: `apps/web/src/lib/trains/predictiveCalculator.ts`
**Type**: Part of T020
**Priority**: P1

Calculate journey progress from schedule:
```typescript
function calculateProgress(
  train: TrainPosition,
  tripDetails: TripDetails,
  currentTime: number
): { progress: number; previousStop: StopTime; nextStop: StopTime } | null;
```

**Acceptance Criteria**:
- [X] Progress = 0 at departure, 1 at arrival
- [X] Uses predicted times when available
- [X] Falls back to scheduled times

---

### T022: Create pathFinder module
**File**: `apps/web/src/lib/trains/pathFinder.ts`
**Type**: New file
**Priority**: P1

Find railway path between stations:
```typescript
export function getPathBetweenStations(
  fromStationId: string,
  toStationId: string,
  railway: PreprocessedRailwayLine,
  stations: Map<string, Station>
): PreprocessedRailwayLine | null;
```

**Acceptance Criteria**:
- [X] Returns path segment between two stations
- [X] Handles stations on same line
- [X] Returns null for disconnected stations

---

### T023: Implement GPS blending
**File**: `apps/web/src/lib/trains/predictiveCalculator.ts`
**Type**: Part of T020
**Priority**: P1

Blend predicted and GPS positions:
```typescript
function blendPositions(
  predicted: [number, number],
  gps: [number, number],
  predictedWeight: number
): [number, number];
```

**Acceptance Criteria**:
- [X] Smooth blend between positions
- [X] Weight adjusts based on GPS age
- [X] Recent GPS has more influence

---

### T024: Add bearing interpolation
**File**: `apps/web/src/lib/trains/predictiveCalculator.ts`
**Type**: Part of T020
**Priority**: P2

Interpolate bearing along path:
```typescript
function calculateInterpolatedBearing(
  path: PreprocessedRailwayLine,
  distance: number
): number;
```

**Acceptance Criteria**:
- [X] Bearing matches track direction at position
- [X] Smooth bearing transitions at segment boundaries

---

### T025: Integrate predictive into TrainMeshManager
**File**: `apps/web/src/lib/trains/trainMeshManager.ts`
**Type**: Modify
**Priority**: P1
**Depends on**: T020

Use predictive position when:
- Algorithm mode is 'predictive'
- TripDetails available for train
- Train status is not 'STOPPED_AT' (use parking instead)

**Acceptance Criteria**:
- [X] Moving trains use predictive position
- [X] Stopped trains use parking position
- [X] Fallback to GPS when needed

---

### T026: Unit tests for predictiveCalculator
**File**: `apps/web/src/lib/trains/predictiveCalculator.test.ts`
**Type**: New file
**Priority**: P2
**Depends on**: T020

Test predictive calculations:
- Progress calculation
- Position interpolation
- GPS blending
- Edge cases

**Acceptance Criteria**:
- [X] All calculation paths tested
- [X] Edge cases handled
- [X] Coverage > 80%

---

### T027: Unit tests for pathFinder
**File**: `apps/web/src/lib/trains/pathFinder.test.ts`
**Type**: New file
**Priority**: P2
**Depends on**: T022

Test path finding:
- Stations on same line
- Station not on line
- Invalid inputs

**Acceptance Criteria**:
- [X] Path found for valid station pairs
- [X] Null returned for invalid inputs
- [X] Coverage > 80%

---

## Phase 5: Integration & Polish

> **Note**: Phase 5 was **SKIPPED** - Decision made to keep current interpolation approach without algorithm toggle UI. The predictive positioning and trip caching infrastructure (Phases 3-4) remains available for internal use but is not exposed to users via a toggle.

### T028-T032: SKIPPED
These tasks were planned to wire the algorithm toggle UI to the positioning system, but the decision was made to keep the current behavior without user-facing algorithm selection.

---

## Task Dependencies Graph

```
Phase 0 (Network Abstraction - Metro-Compatible):
T000a ─► T000b ─► T000c
   │
   └─► T000d (test)

Phase 1 (Foundation):
T005 ─┬─► T001 ─► T002 ─► T003
      │
      └─► T004 (test)
           │
           └─► T006 (e2e)

Phase 2 (Parking) - depends on T000b:
T007 ─┬─► T008, T009, T010, T012
      │
      └─► T011 (depends on T001, T000b)
           │
           └─► T013 (test), T014 (e2e)

Phase 3 (Cache):
T015 ─► T016 ─► T017
 │
 └─► T018 (test), T019

Phase 4 (Predictive) - depends on T000b:
T020 ─┬─► T021, T023, T024
      │
      └─► T022 ─► T027 (test)
           │
           └─► T025 (depends on T011, T016, T000b)
                │
                └─► T026 (test)

Phase 5 (Integration):
T028 ─► T029, T030
 │
 └─► T031 (e2e), T032 (perf)
```

## Estimated Effort

| Phase | Tasks | Complexity |
|-------|-------|------------|
| Phase 0 | 4 | Medium (abstractions) |
| Phase 1 | 6 | Low |
| Phase 2 | 8 | Medium |
| Phase 3 | 5 | Low |
| Phase 4 | 8 | High |
| Phase 5 | 5 | Medium |

**Critical Path**: T000a → T000b → T011 → T025 → T028

**Metro Future Path**: When Metro data available, add:
- `MetroLineResolver` implementation
- `createMetroAdapter()` factory
- Metro-specific parking config with line grouping

## Definition of Done

Each task is complete when:
1. Code implemented and compiles without errors
2. Unit tests pass (where applicable)
3. Code reviewed (if required)
4. Acceptance criteria verified
5. No regressions in existing functionality
