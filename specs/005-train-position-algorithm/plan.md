# Implementation Plan: Train Position Algorithm with Station Parking

**Feature Branch**: `005-train-position-algorithm`
**Created**: 2025-12-06
**Status**: Ready for Implementation

## Overview

This feature introduces a dual-algorithm system for train positioning:
1. **GPS-Only Mode** (existing): Direct GPS coordinates with basic interpolation
2. **Predictive Mode** (new): Schedule-based position calculation with station parking

The implementation preserves backward compatibility while adding user control over positioning behavior.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        UI Layer                                  │
│  ┌──────────────────┐    ┌──────────────────────────────────┐  │
│  │ AlgorithmToggle  │    │         TrainLayer3D             │  │
│  │    Component     │    │   (renders based on algorithm)   │  │
│  └────────┬─────────┘    └──────────────┬───────────────────┘  │
│           │                             │                       │
└───────────┼─────────────────────────────┼───────────────────────┘
            │                             │
┌───────────┼─────────────────────────────┼───────────────────────┐
│           ▼           State Layer       ▼                       │
│  ┌──────────────────┐    ┌──────────────────────────────────┐  │
│  │ AlgorithmState   │◄──►│      TrainMeshManager            │  │
│  │  (Zustand)       │    │  (position calculation)          │  │
│  └──────────────────┘    └──────────────────────────────────┘  │
│                                         │                       │
└─────────────────────────────────────────┼───────────────────────┘
                                          │
┌─────────────────────────────────────────┼───────────────────────┐
│                    Algorithm Layer      │                       │
│  ┌──────────────────────────────────────┼───────────────────┐  │
│  │              PositionCalculator      ▼                   │  │
│  │  ┌─────────────────┐  ┌─────────────────────────────┐   │  │
│  │  │  GPS-Only       │  │  Predictive                 │   │  │
│  │  │  Strategy       │  │  Strategy                   │   │  │
│  │  │                 │  │  ┌─────────────────────┐    │   │  │
│  │  │  • Snap to rail │  │  │ StationParking      │    │   │  │
│  │  │  • Interpolate  │  │  │ • Perpendicular     │    │   │  │
│  │  │                 │  │  │ • Slot assignment   │    │   │  │
│  │  │                 │  │  └─────────────────────┘    │   │  │
│  │  │                 │  │  ┌─────────────────────┐    │   │  │
│  │  │                 │  │  │ TimeInterpolation   │    │   │  │
│  │  │                 │  │  │ • Schedule-based    │    │   │  │
│  │  │                 │  │  │ • GPS blending      │    │   │  │
│  │  │                 │  │  └─────────────────────┘    │   │  │
│  │  └─────────────────┘  └─────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Algorithm State & Toggle UI

**Goal**: Add user control for algorithm selection with persistence

**Components:**
- `AlgorithmState` - Zustand store for algorithm preference
- `AlgorithmToggle` - UI component in map controls
- localStorage persistence for preference

**Files to Create:**
- `apps/web/src/state/algorithm/algorithmStore.ts`
- `apps/web/src/features/map/AlgorithmToggle.tsx`

**Files to Modify:**
- `apps/web/src/features/map/MapControls.tsx` (add toggle)

**Dependencies:** None (independent foundation)

---

### Phase 2: Station Parking System

**Goal**: Display stopped trains perpendicular to track around station markers

**Components:**
- `StationParkingCalculator` - Compute parking slot positions
- Integration with TrainMeshManager for STOPPED_AT trains

**Algorithm:**
```typescript
function calculateParkingPosition(
  stationId: string,
  trainId: string,
  stationCoords: [number, number],
  railwayLine: PreprocessedRailwayLine
): ParkingPosition {
  // 1. Snap station to railway to get track bearing
  const snap = snapTrainToRailway(stationCoords, railwayLine);
  const trackBearing = snap?.bearing ?? 0;

  // 2. Calculate perpendicular direction (90° from track)
  const perpBearingRad = ((trackBearing + 90) % 360) * Math.PI / 180;

  // 3. Assign deterministic slot index
  const slotIndex = hashString(trainId) % MAX_PARKING_SLOTS;
  const offsetIndex = slotIndex - Math.floor(MAX_PARKING_SLOTS / 2);

  // 4. Calculate offset position
  const offsetMeters = offsetIndex * PARKING_SLOT_SPACING;
  const offsetLng = stationCoords[0] + (offsetMeters / METERS_PER_DEGREE_LNG) * Math.cos(perpBearingRad);
  const offsetLat = stationCoords[1] + (offsetMeters / METERS_PER_DEGREE_LAT) * Math.sin(perpBearingRad);

  return {
    position: [offsetLng, offsetLat],
    bearing: trackBearing,
    slotIndex
  };
}
```

**Files to Create:**
- `apps/web/src/lib/trains/stationParking.ts`

**Files to Modify:**
- `apps/web/src/lib/trains/trainMeshManager.ts` (integrate parking)

**Dependencies:** Phase 1 (algorithm state)

---

### Phase 3: Trip Details Caching

**Goal**: Fetch and cache trip schedule data for predictive algorithm

**Components:**
- `TripDetailsCache` - In-memory cache with TTL
- Integration with train API client

**Cache Strategy:**
- Fetch TripDetails when train first appears
- Cache by tripId with 10-minute TTL
- Refresh on cache miss or expiry
- Pre-fetch for trains entering viewport

**Files to Create:**
- `apps/web/src/lib/trains/tripCache.ts`

**Files to Modify:**
- `apps/web/src/lib/api/trains.ts` (add caching layer)
- `apps/web/src/features/trains/TrainLayer3D.tsx` (trigger fetches)

**Dependencies:** None (can parallel with Phase 2)

---

### Phase 4: Predictive Interpolation

**Goal**: Calculate train position based on schedule and delays

**Components:**
- `PredictiveCalculator` - Time-based position interpolation
- GPS blending for accuracy
- Railway path sampling between stations

**Algorithm:**
```typescript
function calculatePredictivePosition(
  train: TrainPosition,
  tripDetails: TripDetails,
  currentTime: number,
  railwayLines: Map<string, PreprocessedRailwayLine>
): PredictedPosition {
  // 1. Find current segment (previous stop -> next stop)
  const currentStop = findCurrentStop(train, tripDetails);
  const previousStop = tripDetails.stopTimes[currentStop.stopSequence - 1];
  const nextStop = tripDetails.stopTimes[currentStop.stopSequence];

  // 2. Calculate time-based progress
  const departureTime = parseTime(previousStop.predictedDepartureUtc ?? previousStop.scheduledDeparture);
  const arrivalTime = parseTime(nextStop.predictedArrivalUtc ?? nextStop.scheduledArrival);
  const totalDuration = arrivalTime - departureTime;
  const elapsed = currentTime - departureTime;
  const progress = Math.max(0, Math.min(1, elapsed / totalDuration));

  // 3. Get railway path between stations
  const lineId = extractLineFromRouteId(train.routeId);
  const railway = railwayLines.get(lineId);
  const pathSegment = getPathBetweenStations(
    previousStop.stopId,
    nextStop.stopId,
    railway
  );

  // 4. Sample position along path
  const distance = pathSegment.totalLength * progress;
  const predicted = sampleRailwayPosition(pathSegment, distance);

  // 5. Blend with GPS if recent
  const gpsAge = currentTime - parseTime(train.polledAtUtc);
  if (gpsAge < 30000 && train.latitude && train.longitude) {
    // 70% predicted, 30% GPS for smooth blending
    return blendPositions(predicted, [train.longitude, train.latitude], 0.7);
  }

  return predicted;
}
```

**Files to Create:**
- `apps/web/src/lib/trains/predictiveCalculator.ts`
- `apps/web/src/lib/trains/pathFinder.ts` (station-to-station paths)

**Files to Modify:**
- `apps/web/src/lib/trains/trainMeshManager.ts` (integrate predictive)
- `apps/web/src/lib/trains/geometry.ts` (add path utilities)

**Dependencies:** Phase 3 (trip cache)

---

### Phase 5: Integration & Polish

**Goal**: Connect all components and ensure smooth operation

**Tasks:**
- Connect algorithm toggle to position calculation
- Add smooth transitions when switching algorithms
- Handle edge cases (missing data, fallbacks)
- Performance optimization and profiling
- Debug panel updates

**Files to Modify:**
- `apps/web/src/features/trains/TrainLayer3D.tsx`
- `apps/web/src/lib/trains/trainMeshManager.ts`
- `apps/web/src/features/trains/TrainDebugPanel.tsx`

**Dependencies:** Phases 1-4

---

## Technical Decisions

### 0. Network Adapter Pattern (Metro-Compatible)

All position calculations go through a `TransitNetworkAdapter` that abstracts network-specific differences:

```typescript
interface TransitNetworkAdapter {
  networkType: 'rodalies' | 'metro';
  lineResolver: LineResolver;
  railwayLines: Map<string, PreprocessedRailwayLine>;
  stations: Map<string, Station>;
  parkingConfig: ParkingConfig;
  predictiveConfig: PredictiveConfig;
}
```

**Key abstraction: LineResolver**

All line-related lookups use `LineResolver` interface:
- `resolveLineId(train)` - determines which line a train is on
- `lineServesStation(lineId, stationId)` - checks station membership
- `getLineBearingAtStation(lineId, stationId)` - gets track direction

**Rodalies**: Simple 1:1 routeId→lineId mapping
**Metro (future)**: Complex resolution via trip mapping or station inference

### 1. Strategy Pattern for Algorithms

Use a strategy pattern to cleanly separate GPS-only and predictive logic:

```typescript
interface PositionStrategy {
  calculatePosition(
    train: TrainPosition,
    context: PositionContext
  ): CalculatedPosition;
}

class GpsOnlyStrategy implements PositionStrategy { ... }
class PredictiveStrategy implements PositionStrategy { ... }
```

### 2. Zustand for Algorithm State

Use Zustand (already in project for train state) for algorithm preferences:
- Simple, minimal boilerplate
- Built-in persistence middleware
- Consistent with existing patterns

### 3. In-Memory Trip Cache

Don't persist trip data:
- Changes frequently with delays
- Small memory footprint (~100 trips * ~2KB = 200KB)
- Fast to re-fetch on page load

### 4. Perpendicular Parking Slots

Use fixed slot count with zoom-responsive spacing:
- 5 slots (-2, -1, 0, +1, +2)
- Base spacing: 20m at zoom 14
- Scale spacing with zoom for visual consistency

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Schedule data unavailable | Fall back to GPS-only for that train |
| Performance degradation | Profile early, cache aggressively |
| Parking slots overflow | Stack vertically for >5 trains |
| Algorithm mismatch | Smooth 500ms transition on switch |

## Testing Strategy

### Unit Tests
- `stationParking.ts`: Slot calculation, perpendicular math
- `predictiveCalculator.ts`: Time interpolation, progress calculation
- `tripCache.ts`: Cache hit/miss, TTL expiry

### Integration Tests
- Algorithm toggle persists across sessions
- Trains transition smoothly on algorithm switch
- Fallback to GPS when schedule unavailable

### E2E Tests
- Toggle algorithm and verify train positions change
- Zoom to station with stopped trains, verify parking layout
- Observe train movement smoothness in predictive mode

## Success Metrics

1. **Smoothness**: No visible "jumping" between positions (visual test)
2. **Parking clarity**: Stopped trains separated with ≥10px gap at zoom 14+
3. **Toggle response**: Algorithm switch completes in <200ms
4. **Performance**: Maintain 30+ FPS with 100 trains
5. **Accuracy**: Predicted positions within 50m of GPS on average
