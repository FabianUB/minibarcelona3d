# Optimization Roadmap

This document tracks larger refactoring opportunities identified during the codebase optimization audit. These are organized by impact and effort required.

---

## 1. Position Simulator Unification

**Status:** ✅ Complete
**Impact:** High (~600 lines unified, ~280 lines net savings)
**Effort:** Medium (implemented in ~1 hour)

### Problem

Four nearly identical position simulators existed with ~95% duplicate code.

### Solution

Created `apps/web/src/lib/transit/positionSimulatorFactory.ts` (350 lines) with:
- `findClosestDistanceOnLine()` - shared geometry projection
- `findStopsBetween()` - shared stop ordering
- `orderStopsByDistance()` - shared stop sorting
- `generateLinePositions()` - unified position generation algorithm
- `createPositionSimulator()` - factory function returning full API

### Results

| File | Before | After | Saved |
|------|--------|-------|-------|
| `metro/positionSimulator.ts` | 481 | 179 | 302 |
| `bus/positionSimulator.ts` | 413 | 203 | 210 |
| `tram/positionSimulator.ts` | 203 | 140 | 63 |
| `fgc/positionSimulator.ts` | 203 | 140 | 63 |
| **Total** | **1,300** | **662 + 350 factory = 1,012** | **~288** |

All network simulators now:
- Use the unified factory with network-specific configuration
- Maintain full backward compatibility with existing exports
- Support optional stop tracking (Metro, Bus have it; Tram, FGC don't)

---

## 2. Generic Mapbox Line Layer Component

**Status:** ✅ Complete
**Impact:** High (~700 lines saved)
**Effort:** Low (~30 min)

### Solution

Created `apps/web/src/features/transit/GenericLineLayer.tsx` (310 lines) with:
- Configurable source/layer IDs, line code property
- Network-specific line widths and opacities
- Shared data loading, visibility, and highlighting logic
- Optional feature filtering (used by Bus for top lines)

### Results

| File | Before | After | Saved |
|------|--------|-------|-------|
| `metro/MetroLineLayer.tsx` | 237 | 42 | 195 |
| `bus/BusLineLayer.tsx` | 262 | 60 | 202 |
| `tram/TramLineLayer.tsx` | 237 | 42 | 195 |
| `fgc/FGCLineLayer.tsx` | 237 | 42 | 195 |
| **Total** | **973** | **186 + 310 factory = 496** | **~477** |

All network layers now delegate to GenericLineLayer with configuration presets.

---

## 3. Generic Station/Stop Layer Component

**Status:** ✅ Complete
**Impact:** High (~850 lines saved)
**Effort:** Low (~30 min)

### Solution

Created `apps/web/src/features/transit/GenericStopLayer.tsx` (370 lines) with:
- Configurable circle radius, stroke width, label size
- Network-specific opacity and min zoom settings
- Fallback colors for Tram/FGC
- Shared filtering, highlighting, and click handlers

### Results

| File | Before | After | Saved |
|------|--------|-------|-------|
| `metro/MetroStationLayer.tsx` | 295 | 45 | 250 |
| `bus/BusStopLayer.tsx` | 287 | 45 | 242 |
| `tram/TramStopLayer.tsx` | 287 | 45 | 242 |
| `fgc/FGCStationLayer.tsx` | 287 | 45 | 242 |
| **Total** | **1,156** | **180 + 370 factory = 550** | **~606** |

All station/stop layers now delegate to GenericStopLayer with configuration presets.

---

## 4. Consolidated API Retry Logic

**Status:** ✅ Complete (ac89e23)
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

**Status:** ✅ Complete (ac89e23)
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

**Status:** ✅ Complete (ac89e23)
**Impact:** Low (~14.6KB savings: 8KB JS + 6.6KB CSS)
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
   - [x] Consolidated API retry logic (#4) - ✅ Done in ac89e23
   - [x] Unified config helpers (#5) - ✅ Done in ac89e23
   - [x] Remove unused dependencies (#7) - ✅ Done in ac89e23

2. **High-impact refactors:**
   - [x] Position simulator unification (#1) - ✅ Done
   - [x] Generic line layer (#2) - ✅ Done
   - [x] Generic station layer (#3) - ✅ Done

3. **Bundle optimization:**
   - [ ] Lazy-load network layers (#6)

---

## Notes

- All refactors should maintain existing behavior (no functional changes)
- Each refactor should be its own commit for easy rollback
- Run full test suite after each change
- Update imports across codebase when consolidating
