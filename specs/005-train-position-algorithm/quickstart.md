# Quickstart: Train Position Algorithm with Station Parking

**Feature Branch**: `005-train-position-algorithm`
**Created**: 2025-12-06

## Getting Started

### Prerequisites

- Node.js 20+ and npm 10+
- Completed features from branches:
  - `002-realtime-train-tracking` (train API and 3D rendering)
  - `003-train-line-colors-zoom` (zoom-responsive scaling)
  - `004-station-visualization` (station markers)

### Setup

```bash
# Switch to feature branch
git checkout 005-train-position-algorithm

# Install dependencies
cd apps/web
npm install

# Start development server
npm run dev
```

### Verify Setup

1. Open http://localhost:5173
2. Map should load with trains visible
3. Trains should move smoothly between polling intervals
4. Station markers should be visible at appropriate zoom levels

## Key Files

### New Files to Create

| File | Purpose |
|------|---------|
| `src/types/algorithm.ts` | Type definitions for algorithm system |
| `src/state/algorithm/algorithmStore.ts` | Zustand store for algorithm preference |
| `src/features/map/AlgorithmToggle.tsx` | UI toggle component |
| `src/lib/trains/stationParking.ts` | Station parking calculations |
| `src/lib/trains/tripCache.ts` | Trip details caching |
| `src/lib/trains/predictiveCalculator.ts` | Predictive position algorithm |
| `src/lib/trains/pathFinder.ts` | Station-to-station path finding |

### Files to Modify

| File | Changes |
|------|---------|
| `src/features/map/MapControls.tsx` | Add algorithm toggle |
| `src/lib/trains/trainMeshManager.ts` | Integrate new positioning logic |
| `src/lib/api/trains.ts` | Add cached trip fetching |
| `src/features/trains/TrainLayer3D.tsx` | Wire algorithm state |
| `src/features/trains/TrainDebugPanel.tsx` | Add algorithm debug info |

### Reference Files (Read-Only)

| File | Information |
|------|-------------|
| `src/lib/trains/geometry.ts` | Railway snapping and bearing functions |
| `src/lib/trains/scaleManager.ts` | Zoom-responsive scaling patterns |
| `src/types/trains.ts` | Train data types |
| `src/types/rodalies.ts` | Station and line types |

## Development Workflow

### Phase 1: Algorithm Toggle

Start with the UI and state management:

```bash
# 1. Create algorithm types
touch src/types/algorithm.ts

# 2. Create Zustand store
mkdir -p src/state/algorithm
touch src/state/algorithm/algorithmStore.ts

# 3. Create toggle component
touch src/features/map/AlgorithmToggle.tsx

# 4. Run tests
npm test -- algorithmStore
```

**Verification:**
- Toggle appears in map controls
- Clicking toggle changes state
- Refresh preserves selection

### Phase 2: Station Parking

Implement parking for STOPPED_AT trains:

```bash
# 1. Create parking module
touch src/lib/trains/stationParking.ts

# 2. Write unit tests first
touch src/lib/trains/stationParking.test.ts

# 3. Run tests
npm test -- stationParking
```

**Verification:**
- Enable predictive mode
- Find station with stopped trains
- Trains should arrange perpendicular to track

### Phase 3: Trip Caching

Add caching layer for schedule data:

```bash
# 1. Create cache module
touch src/lib/trains/tripCache.ts

# 2. Add tests
touch src/lib/trains/tripCache.test.ts

# 3. Run tests
npm test -- tripCache
```

**Verification:**
- Check Network tab - should see one request per tripId
- Second access should be instant (no network request)

### Phase 4: Predictive Algorithm

Implement schedule-based positioning:

```bash
# 1. Create calculator
touch src/lib/trains/predictiveCalculator.ts
touch src/lib/trains/pathFinder.ts

# 2. Add tests
touch src/lib/trains/predictiveCalculator.test.ts
touch src/lib/trains/pathFinder.test.ts

# 3. Run tests
npm test -- predictive pathFinder
```

**Verification:**
- Enable predictive mode
- Trains should move smoothly based on schedule
- Position should roughly match GPS

### Phase 5: Integration

Wire everything together:

```bash
# 1. Modify TrainLayer3D to use algorithm state
# 2. Modify TrainMeshManager to use new calculators
# 3. Run E2E tests
npm run test:e2e -- algorithm
```

## Testing Commands

```bash
# Unit tests (watch mode)
npm test

# Specific test file
npm test -- stationParking

# All tests once
npm test -- --run

# E2E tests
npm run test:e2e

# Specific E2E test
npm run test:e2e -- algorithm-toggle.spec.ts
```

## Debugging

### Debug Panel

The TrainDebugPanel shows:
- Current algorithm mode
- Position source per train
- Cache statistics

Enable with: Click debug button in map controls.

### Console Logging

Key log prefixes:
- `TrainMeshManager:` - Position calculations
- `TripCache:` - Cache hits/misses
- `StationParking:` - Parking slot assignments
- `PredictiveCalc:` - Schedule-based positioning

### Common Issues

**Trains jump on algorithm switch:**
- Check transition logic in TrainMeshManager
- Verify `isTransitioning` flag handling

**Parking slots overlap:**
- Check hash function distribution
- Verify perpendicular bearing calculation

**Predictive positions way off:**
- Check TripDetails data freshness
- Verify station-to-station path finding
- Check GPS blending weights

## Code Patterns

### Using Algorithm State

```typescript
import { useAlgorithmState } from '../state/algorithm/algorithmStore';

function MyComponent() {
  const mode = useAlgorithmState((state) => state.mode);
  const setMode = useAlgorithmState((state) => state.setMode);

  return (
    <button onClick={() => setMode('predictive')}>
      Current: {mode}
    </button>
  );
}
```

### Calculating Parking Position

```typescript
import { calculateParkingPosition } from '../lib/trains/stationParking';

const parking = calculateParkingPosition(
  stationId,
  trainId,
  stationCoords,
  railwayLine
);

// Use parking.position and parking.bearing
```

### Fetching Cached Trip Details

```typescript
import { tripCache } from '../lib/trains/tripCache';

const tripDetails = await tripCache.getOrFetch(tripId);

// tripDetails.stopTimes contains schedule
```

### Calculating Predictive Position

```typescript
import { calculatePredictivePosition } from '../lib/trains/predictiveCalculator';

const calculated = calculatePredictivePosition(
  train,
  tripDetails,
  Date.now(),
  railwayLines,
  stations
);

if (calculated) {
  // Use calculated.position, calculated.bearing, calculated.source
}
```

## Performance Considerations

### Caching

- Trip details: 10-minute TTL, ~200 entries
- Station paths: Session-long, ~100 entries
- Parking positions: Session-long, ~50 entries

### Hot Paths

These run every frame, keep minimal:
- `animatePositions()` - position interpolation
- `applyZoomResponsiveScale()` - zoom scaling

### Profiling

```bash
# Build with profiling
npm run build -- --profile

# Analyze bundle
npm run analyze-bundle
```

## Checklist Before PR

- [ ] All unit tests pass (`npm test -- --run`)
- [ ] E2E tests pass (`npm run test:e2e`)
- [ ] No TypeScript errors (`npm run build`)
- [ ] No ESLint errors (`npm run lint`)
- [ ] Algorithm toggle works on mobile
- [ ] Trains don't overlap when parked
- [ ] Smooth transitions when switching algorithms
- [ ] FPS stays above 30 with 100+ trains
- [ ] localStorage persistence works
