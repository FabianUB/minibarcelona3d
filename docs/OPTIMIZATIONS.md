# Optimization Roadmap

This document tracks larger refactoring opportunities identified during the codebase optimization audit. These are organized by impact and effort required.

---

## 1. Position Simulator Unification

**Status:** Pending
**Impact:** High (~1,000 lines saved)
**Effort:** Medium (2-3 hours)

### Problem

Four nearly identical position simulators exist:
- `apps/web/src/lib/metro/positionSimulator.ts` (440 lines)
- `apps/web/src/lib/bus/positionSimulator.ts` (413 lines)
- `apps/web/src/lib/tram/positionSimulator.ts` (203 lines)
- `apps/web/src/lib/fgc/positionSimulator.ts` (203 lines)

~95% of the code is duplicated across these files.

### Duplicated Functions
- `findClosestDistanceOnLine()` / `findClosestDistanceOnRoute()`
- `findStationsBetween()` / `findStopsBetween()`
- Station/stop ordering with distance calculations
- Main vehicle position generation loop
- Preprocessing and caching infrastructure
- Preload/clear functions

### Solution

Create a generic `positionSimulatorFactory.ts`:

```typescript
// apps/web/src/lib/transit/positionSimulatorFactory.ts

interface SimulatorConfig {
  networkType: TransportType;
  loadGeometry: (lineCode: string) => Promise<GeoJSON.FeatureCollection>;
  loadStops: (lineCode: string) => Promise<Stop[]>;
  getLineConfig: (lineCode: string) => LineConfig;
  vehicleSizeMeters: number;
}

export function createPositionSimulator(config: SimulatorConfig) {
  // Unified implementation with config-driven behavior
}
```

Each network re-exports with its own config:
```typescript
// apps/web/src/lib/metro/positionSimulator.ts
export const { generateAllPositions, preloadGeometries } =
  createPositionSimulator(METRO_CONFIG);
```

---

## 2. Generic Mapbox Line Layer Component

**Status:** Pending
**Impact:** High (~800 lines saved)
**Effort:** Medium (2-3 hours)

### Problem

Four similar line layer components:
- `apps/web/src/features/metro/MetroLineLayer.tsx` (237 lines)
- `apps/web/src/features/bus/BusLineLayer.tsx` (262 lines)
- `apps/web/src/features/tram/TramLineLayer.tsx` (~237 lines)
- `apps/web/src/features/fgc/FGCLineLayer.tsx` (~237 lines)

### Duplicated Code
- Data loading effect pattern
- Mapbox source/layer creation (95% identical)
- Visibility/highlighting effects (exact same logic)
- Opacity/width expressions

### Solution

Create `GenericLineLayer.tsx`:

```typescript
interface GenericLineLayerProps {
  networkType: TransportType;
  sourceId: string;
  loadGeoJSON: () => Promise<GeoJSON.FeatureCollection>;
  lineColorProperty: string; // e.g., 'line_color' or 'route_color'
  lineCodeProperty: string;  // e.g., 'line_code' or 'route_code'
  visible: boolean;
  highlightedLineIds: string[];
  isolateMode: boolean;
}

export function GenericLineLayer(props: GenericLineLayerProps) {
  // Unified implementation
}
```

---

## 3. Generic Station/Stop Layer Component

**Status:** Pending
**Impact:** High (~800 lines saved)
**Effort:** Medium (2-3 hours)

### Problem

Four similar station layer components:
- `apps/web/src/features/metro/MetroStationLayer.tsx` (238 lines)
- `apps/web/src/features/bus/BusStopLayer.tsx` (245 lines)
- `apps/web/src/features/tram/TramStopLayer.tsx` (~245 lines)
- `apps/web/src/features/fgc/FGCStationLayer.tsx` (~245 lines)

### Duplicated Code
- Data loading pattern
- Circle marker layer creation
- Label layer creation
- Hover state management
- Click handlers
- Visibility/opacity effects

### Solution

Create `GenericStopLayer.tsx` with configurable properties for station vs stop terminology and styling differences.

---

## 4. Consolidated API Retry Logic

**Status:** Pending
**Impact:** Medium (~100 lines saved)
**Effort:** Low (30 min)

### Problem

Identical retry/backoff logic in:
- `apps/web/src/lib/api/trains.ts` (283 lines)
- `apps/web/src/lib/api/metro.ts` (175 lines)

### Duplicated Code
```typescript
const RETRY_CONFIG = { maxAttempts: 3, baseDelay: 1000, maxDelay: 5000 };
function sleep(ms: number)
function getRetryDelay(attempt: number)
async function fetchWithRetry(url, options)
async function parseErrorResponse(response)
```

### Solution

Extract to `apps/web/src/lib/api/fetchWithRetry.ts`:

```typescript
export const RETRY_CONFIG = { ... };
export function sleep(ms: number): Promise<void>;
export function getRetryDelay(attempt: number): number;
export async function fetchWithRetry<T>(url: string, options?: RequestInit): Promise<T>;
```

---

## 5. Unified Config Helper Functions

**Status:** Pending
**Impact:** Medium (~100 lines saved)
**Effort:** Low (30 min)

### Problem

Identical helper patterns in:
- `apps/web/src/config/metroConfig.ts`
- `apps/web/src/config/busConfig.ts`
- `apps/web/src/config/tramConfig.ts`
- `apps/web/src/config/fgcConfig.ts`

### Duplicated Functions
```typescript
export function getXxxLineCodes(): string[]
export function getXxxLineConfig(lineCode: string): LineConfig | undefined
export function calculateVehiclesPerDirection(totalLength: number, lineCode: string): number
```

### Solution

Create `apps/web/src/config/transitConfigFactory.ts`:

```typescript
export function createConfigHelpers<T extends LineConfig>(
  config: Record<string, T>
) {
  return {
    getLineCodes: () => Object.keys(config),
    getLineConfig: (code: string) => config[code],
    calculateVehiclesPerDirection: (length: number, code: string) => { ... }
  };
}
```

---

## 6. Lazy-Load Disabled Network Layers

**Status:** Pending
**Impact:** Medium (50-100KB bundle savings)
**Effort:** Medium (1-2 hours)

### Problem

All layer components are statically imported in `MapCanvas.tsx`:

```typescript
import { MetroLineLayer, MetroStationLayer } from '../metro';
import { BusLineLayer, BusStopLayer } from '../bus';
import { TramLineLayer, TramStopLayer } from '../tram';
import { FGCLineLayer, FGCStationLayer } from '../fgc';
```

Initial bundle includes all code even if user only views Rodalies.

### Solution

Use React.lazy for network layers:

```typescript
const MetroLayers = lazy(() => import('../metro'));
const BusLayers = lazy(() => import('../bus'));

// In render:
{ui.transportFilters.metro && (
  <Suspense fallback={null}>
    <MetroLayers.MetroLineLayer ... />
  </Suspense>
)}
```

---

## 7. Remove Unused Dependencies

**Status:** Pending
**Impact:** Low (~8KB bundle savings)
**Effort:** Low (10 min)

### Candidates
- `cmdk` - Command palette library imported but not used in app
- `tw-animate-css` - Listed in devDependencies but no imports found

### Verification
```bash
grep -r "from 'cmdk'" apps/web/src/  # Check actual usage
grep -r "tw-animate" apps/web/src/   # Check actual usage
```

---

## Implementation Order (Recommended)

1. **Quick wins first:**
   - [ ] Consolidated API retry logic (#4)
   - [ ] Unified config helpers (#5)
   - [ ] Remove unused dependencies (#7)

2. **High-impact refactors:**
   - [ ] Position simulator unification (#1)
   - [ ] Generic line layer (#2)
   - [ ] Generic station layer (#3)

3. **Bundle optimization:**
   - [ ] Lazy-load network layers (#6)

---

## Notes

- All refactors should maintain existing behavior (no functional changes)
- Each refactor should be its own commit for easy rollback
- Run full test suite after each change
- Update imports across codebase when consolidating
