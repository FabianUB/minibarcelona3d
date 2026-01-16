# Quickstart Guide: Enhanced Train Spatial Separation and Zoom-Responsive Sizing

**Feature**: 003-train-line-colors-zoom
**Date**: 2025-11-10
**Target Audience**: Developers implementing or testing this feature

## Overview

This guide provides step-by-step instructions for setting up, developing, and testing enhanced spatial separation and zoom-responsive sizing for trains.

**Context**: Railway lines on the map already have different colors. This feature enhances train visualization by:
- **PRIMARY (P1)**: Spatial separation at high zoom + zoom-responsive sizing
- **SECONDARY (P2)**: Hover outline with line color

## Prerequisites

- Node.js 18+ and npm installed
- Repository cloned locally
- Basic familiarity with TypeScript, React, Three.js, and Mapbox GL JS
- Branch `003-train-line-colors-zoom` checked out

## Quick Setup

### 1. Install Dependencies

```bash
cd apps/web
npm install
```

### 2. Environment Configuration

Ensure `.env.local` exists with Mapbox token:

```bash
# apps/web/.env.local
VITE_VITE_MAPBOX_TOKEN=your_mapbox_token_here
VITE_API_BASE=/api
```

**Note**: Mapbox token required for map rendering. Get one at https://mapbox.com/

### 3. Start Development Server

```bash
npm run dev
```

Open http://localhost:5173 in your browser.

---

## Development Workflow

### File Structure

Key files for this feature:

```
apps/web/src/
├── lib/
│   ├── trains/
│   │   ├── trainMeshManager.ts       # MODIFY: Enhanced offset + scale
│   │   ├── scaleManager.ts           # NEW: Zoom-responsive scale
│   │   └── outlineManager.ts         # NEW: Hover outline (optional)
│   └── rodalies/
│       └── dataLoader.ts             # EXISTING: Load RodaliesLine data
├── features/trains/
│   └── TrainLayer3D.tsx              # MODIFY: Initialize scale/offset systems
└── types/
    └── rodalies.ts                   # EXISTING: RodaliesLine interface
```

### Development Phases

#### Phase A: Lateral Offset Enhancement (P1)

1. **Enhance lateral offset computation** in `TrainMeshManager`:
   ```typescript
   private computeLateralOffset(index: number, zoom: number): number {
     const offsetMultiplier = index - 2;  // [-2, -1, 0, 1, 2]
     const zoomFactor = zoom > 14 ? 1.5 : 1.0;  // 1.6m → 2.4m at high zoom
     return this.LATERAL_OFFSET_STEP_METERS * offsetMultiplier * zoomFactor;
   }
   ```

2. **Test offset behavior**:
   ```bash
   npm test -- trainMeshManager
   ```

3. **Visual verification**:
   - Find station with multiple trains (e.g., Barcelona-Sants)
   - Zoom from level 10 to 17
   - Verify separation increases at zoom > 14

#### Phase B: Zoom-Responsive Scale (P1)

1. **Create ScaleManager utility** (`apps/web/src/lib/trains/scaleManager.ts`):
   ```typescript
   export class ScaleManager implements IScaleManager {
     private scaleCache: Map<number, number> = new Map();
     private config: ScaleConfig;

     computeScale(zoom: number): number {
       const bucket = this.quantizeZoom(zoom);
       if (!this.scaleCache.has(bucket)) {
         this.scaleCache.set(bucket, this.calculateScale(zoom));
       }
       return this.scaleCache.get(bucket)!;
     }

     private calculateScale(zoom: number): number {
       const zoomDelta = zoom - this.config.referenceZoom;
       const baseMultiplier = Math.pow(0.5, zoomDelta);
       const minMultiplier = this.config.minHeightPx / this.config.targetHeightPx;
       const maxMultiplier = this.config.maxHeightPx / this.config.targetHeightPx;
       return Math.max(minMultiplier, Math.min(maxMultiplier, baseMultiplier));
     }

     private quantizeZoom(zoom: number): number {
       return Math.round(zoom / this.config.zoomBucketSize) * this.config.zoomBucketSize;
     }
   }
   ```

2. **Test ScaleManager** (`apps/web/tests/unit/scaleManager.test.ts`):
   ```bash
   npm test -- scaleManager
   ```

3. **Integrate with render loop**:
   - Add `ScaleManager` to `TrainLayer3D`
   - Call `computeScale()` in `customLayer.render()`
   - Apply scale to `mesh.scale`

#### Phase C: Hover Outline (P2 - Optional)

1. **Create OutlineManager utility** (`apps/web/src/lib/trains/outlineManager.ts`):
   ```typescript
   export function createOutlineMesh(
     trainMesh: THREE.Group,
     lineColor: THREE.Color,
     config: OutlineConfig
   ): THREE.Group {
     const outlineGroup = new THREE.Group();

     trainMesh.traverse((child) => {
       if (child instanceof THREE.Mesh) {
         const outlineGeometry = child.geometry.clone();
         const outlineMaterial = new THREE.MeshBasicMaterial({
           color: lineColor,
           side: THREE.BackSide,
           transparent: true,
           opacity: config.opacity,
         });

         const outlineMesh = new THREE.Mesh(outlineGeometry, outlineMaterial);
         outlineMesh.scale.multiplyScalar(config.scaleFactor);
         outlineMesh.renderOrder = child.renderOrder - 1;

         outlineGroup.add(outlineMesh);
       }
     });

     outlineGroup.visible = false; // Hidden by default
     return outlineGroup;
   }
   ```

2. **Integrate with hover system**:
   - Modify `TrainLayer3D.handlePointerMove()` to create/show outline on hover
   - Extract line code from `routeId` using `extractLineFromRouteId()`
   - Lookup brand color from RodaliesLine data
   - Create outline mesh lazily (only on first hover)

---

## Testing Scenarios

### Primary (P1): Spatial Separation Testing

#### Scenario 1: Co-Located Train Separation at High Zoom

**Steps**:
1. Start dev server: `npm run dev`
2. Open browser to http://localhost:5173
3. Find a busy station (e.g., Barcelona-Sants, Plaça de Catalunya)
4. Zoom to level 10 (normal view)
5. Observe train positioning (trains should be close but distinguishable)
6. Zoom in to level 16 (high zoom)
7. Observe train separation (trains should spread out side-by-side)

**Expected Results**:
- **Zoom 10**: Trains at ~1.6m lateral offset (~8px separation)
- **Zoom 16**: Trains at ~2.4m lateral offset (~24px separation)
- Smooth transition when zooming between levels
- Each train maintains consistent offset position (no random jumping)

**Verification**:
- At least 2-3 meters visible gap between trains at zoom 16
- Offset applies perpendicular to railway line bearing
- Trains from same line and different lines all separated equally

#### Scenario 2: Zoom-Responsive Sizing

**Steps**:
1. Load map with trains visible
2. Zoom out to level 5 (minimum zoom)
3. Measure train screen-space height using browser DevTools
4. Gradually zoom in to level 17 (maximum zoom)
5. Observe train size changes at each zoom level

**Expected Results**:

| Zoom Level | Expected Screen Height | Visual Assessment |
|------------|----------------------|-------------------|
| 5          | ~12-15px             | Small but visible |
| 10         | ~25px                | Target size |
| 15         | ~30-35px             | Larger but not obstructive |
| 17         | ~40px                | Clamped to maximum |

**Verification**:
- Use browser DevTools Element Inspector to measure actual pixel height
- Trains never become invisible (<12px) or overwhelming (>40px)
- Smooth size transitions (no jarring jumps)
- Size changes feel natural and predictable

**Measurement Technique**:
```javascript
// In browser console
const trainElement = document.querySelector('[data-train-mesh]');
const rect = trainElement.getBoundingClientRect();
console.log('Train height:', rect.height, 'px');
```

### Secondary (P2): Hover Outline Testing

#### Scenario 3: Line Identification on Hover

**Steps**:
1. Load map with trains visible
2. Hover cursor over an R1 train
3. Observe outline appearance
4. Move cursor to an R2 train
5. Observe outline color change
6. Move cursor away from trains
7. Observe outline disappearance

**Expected Results**:
- R1 trains: Light blue (#7DBCEC) outline
- R2 trains: Green (#26A741) outline
- R3 trains: Red (#EB4128) outline
- Unknown routes: Light gray (#CCCCCC) outline
- Outline appears within 100ms of hover
- Outline disappears smoothly when cursor leaves

**Verification**:
- Outline is 5% larger than base mesh (clearly visible halo)
- Outline follows 3D shape accurately (not a flat overlay)
- Outline opacity ~80% (semi-transparent)
- Outline doesn't interfere with click detection

---

### Automated Unit Tests

#### Run All Tests

```bash
cd apps/web
npm test
```

#### Run Specific Test Suites

```bash
# Scale manager tests
npm test -- scaleManager

# Lateral offset tests
npm test -- trainMeshManager

# Integration tests
npm test -- TrainLayer3D
```

#### Test Coverage

Expected coverage targets:
- `scaleManager.ts`: >95% coverage
- `trainMeshManager.ts` (lateral offset): >80% coverage
- `outlineManager.ts`: >90% coverage (if implemented)

### End-to-End Tests

#### Run E2E Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run only train spatial/zoom tests
npm run test:e2e -- train-spatial-zoom.spec.ts

# Run with UI (headed mode)
npm run test:e2e -- --headed train-spatial-zoom.spec.ts
```

#### E2E Test Scenarios

File: `apps/web/e2e/train-spatial-zoom.spec.ts`

**Test 1**: Spatial separation at high zoom
- Set zoom to 10, measure train positions
- Set zoom to 16, measure train positions
- Verify separation increased by ~50% (1.6m → 2.4m)

**Test 2**: Zoom-responsive sizing works
- Set zoom to 5, measure train size
- Set zoom to 17, measure train size
- Verify size within expected range (12-40px)

**Test 3**: Performance with 100 trains
- Mock API to return 100 trains
- Measure FPS using `window.performance` API
- Verify FPS > 30 consistently

---

## Performance Testing

### Monitor FPS

Add this to browser console while map is running:

```javascript
let fps = 0;
let lastTime = performance.now();
let frameCount = 0;

function measureFPS() {
  frameCount++;
  const now = performance.now();
  if (now - lastTime >= 1000) {
    fps = frameCount;
    frameCount = 0;
    lastTime = now;
    console.log(`FPS: ${fps}`);
  }
  requestAnimationFrame(measureFPS);
}
measureFPS();
```

**Expected Results**: FPS > 30 with 100 trains

### Profile Performance

1. Open Chrome DevTools → Performance tab
2. Start recording
3. Zoom in/out several times (level 5 to 17)
4. Stop recording
5. Analyze frame times

**Look for**:
- Frame times <33ms (target for 30 FPS)
- No long tasks (>50ms)
- Scale computation <1ms per frame (cache hit)
- Lateral offset computation <0.01ms per train update

**Performance Budget**:
- Scale computation: <0.1ms per frame (100 trains, cached)
- Lateral offset enhancement: <0.01ms per train update
- Outline visibility toggle: <0.01ms per hover event
- Total overhead: <0.2ms per frame

---

## Common Issues & Troubleshooting

### Issue 1: Trains Not Separating at High Zoom

**Symptoms**: Trains remain overlapped at zoom > 14

**Possible Causes**:
1. Zoom threshold not checked correctly
2. Offset multiplier not applied
3. Perpendicular vector calculation error

**Debug Steps**:
```typescript
// Add to computeLateralOffset()
console.log('Zoom:', zoom, 'Multiplier:', zoom > 14 ? 1.5 : 1.0);
console.log('Offset meters:', offsetMeters);
```

**Solution**: Verify `highZoomThreshold` is set to 14, check offset calculation formula

### Issue 2: Trains Too Small/Large

**Symptoms**: Trains not within 12-40px range

**Possible Causes**:
1. ScaleManager not computing correctly
2. Scale not applied to mesh
3. Zoom range misconfigured

**Debug Steps**:
```typescript
// Add to render loop
const scale = scaleManager.computeScale(map.getZoom());
console.log('Zoom:', map.getZoom(), 'Scale:', scale);

// Measure actual screen-space size
const mesh = trainMeshes.get(someVehicleKey);
const screenPos = projectToScreen(mesh.position);
console.log('Screen height:', screenPos.height, 'px');
```

**Solution**: Verify `ScaleConfig` constants, check `getModelScale()` base value

### Issue 3: Performance Drop

**Symptoms**: FPS < 30 with 100 trains

**Possible Causes**:
1. Scale computed per-frame instead of cached
2. Lateral offset computed every frame (should be on position update only)
3. Too many Three.js draw calls

**Debug Steps**:
```typescript
// Add to ScaleManager
console.log('Cache stats:', this.getCacheStats());

// Profile with Chrome DevTools
// Look for hot functions in Performance timeline
```

**Solution**:
- Ensure zoom bucket caching enabled (0.1 increments)
- Verify lateral offset only computed in `updateTrainMeshes()`, not in render loop
- Check Three.js scene hierarchy (no redundant groups)

### Issue 4: Hover Outline Not Appearing

**Symptoms**: No outline visible when hovering over trains

**Possible Causes**:
1. Outline mesh not created
2. Line color lookup failed
3. Outline visibility not toggled
4. Raycaster hit detection not working

**Debug Steps**:
```typescript
// Add to hover handler
console.log('Hover detected:', vehicleKey);
console.log('Outline mesh exists:', trainMeshData.outlineMesh !== undefined);
console.log('Outline visible:', trainMeshData.outlineMesh?.visible);
```

**Solution**: Verify `createOutlineMesh()` called on first hover, check `outlineMesh.visible = true` on hover enter

---

## Development Tips

### Hot Reload

Vite provides fast hot module replacement (HMR). Changes to most files will hot reload without full page refresh.

**Files that trigger full reload**:
- `TrainLayer3D.tsx` (React component with Three.js state)
- `trainMeshManager.ts` (Three.js scene state)

**Files with fast HMR**:
- `scaleManager.ts` (pure utility)
- `outlineManager.ts` (pure utility)
- CSS/style files

### Debugging Three.js

**View scene hierarchy**:
```typescript
// In browser console
console.log(window.__threeScene);  // If exposed for debugging
```

**Inspect mesh properties**:
```typescript
const mesh = trainMeshes.get('some-vehicle-key');
console.log('Scale:', mesh.scale);
console.log('Position:', mesh.position);
console.log('Rotation:', mesh.rotation);

mesh.traverse(child => {
  if (child instanceof THREE.Mesh) {
    console.log('Mesh:', child.name, 'Material:', child.material);
  }
});
```

**Enable Three.js stats**:
```typescript
import Stats from 'three/addons/libs/stats.module.js';
const stats = new Stats();
document.body.appendChild(stats.dom);

// In render loop
stats.update();
```

### Code Formatting

```bash
# Format all files
npm run lint

# Auto-fix issues
npm run lint -- --fix
```

### Type Checking

```bash
# Check TypeScript errors
cd apps/web
npm run build  # Runs tsc -b
```

---

## Testing Checklist

Before submitting PR, verify:

**Primary (P1) Features**:
- [ ] Spatial separation works at zoom > 14 (2-3 meters visible gap)
- [ ] Zoom-responsive sizing maintains 12-40px range across zoom 5-17
- [ ] Smooth transitions when zooming (no jarring jumps)
- [ ] Performance verified (30+ FPS with 100 trains)
- [ ] Lateral offset deterministic (trains don't jump randomly)

**Secondary (P2) Features** (if implemented):
- [ ] Hover outline appears within 100ms of hover
- [ ] Outline color matches line brand color
- [ ] Outline fallback works for unmapped routes (#CCCCCC)
- [ ] Outline doesn't interfere with click detection

**Code Quality**:
- [ ] All unit tests pass (`npm test`)
- [ ] All E2E tests pass (`npm run test:e2e`)
- [ ] No TypeScript errors (`npm run build`)
- [ ] No ESLint errors (`npm run lint`)
- [ ] Manual visual testing completed (all scenarios)

---

## Useful Commands Reference

```bash
# Development
npm run dev                 # Start dev server (http://localhost:5173)
npm run build               # Build for production
npm run preview             # Preview production build

# Testing
npm test                    # Run unit tests (watch mode)
npm test -- --run           # Run unit tests once
npm test -- scaleManager    # Run specific test suite
npm run test:e2e            # Run E2E tests (all browsers)
npm run test:e2e:ci         # Run E2E tests (CI mode, Chromium only)
npm run test:accessibility  # Run accessibility tests

# Linting & Formatting
npm run lint                # Check linting errors
npm run lint -- --fix       # Auto-fix linting errors

# Bundle Analysis
npm run analyze-bundle      # Generate bundle size report
```

---

## Resources

**Documentation**:
- [Feature Spec](./spec.md) - Requirements and success criteria
- [Implementation Plan](./plan.md) - Technical design and architecture
- [Research](./research.md) - Design decisions and alternatives
- [Data Model](./data-model.md) - Entity definitions and relationships
- [Contracts](./contracts/train-color-config.ts) - TypeScript interfaces

**External References**:
- Three.js MeshBasicMaterial: https://threejs.org/docs/#api/en/materials/MeshBasicMaterial
- Three.js BackSide rendering: https://threejs.org/docs/#api/en/constants/Materials
- Mapbox GL JS Camera: https://docs.mapbox.com/mapbox-gl-js/api/map/
- Vitest Docs: https://vitest.dev/
- Playwright Docs: https://playwright.dev/

**Project Docs**:
- [Project README](../../../README.md) - Repository overview
- [CLAUDE.md](../../../CLAUDE.md) - Development guidelines
- [TESTS.md](../../../docs/TESTS.md) - Testing strategy
- [DATABASE_SCHEMA.md](../../../docs/DATABASE_SCHEMA.md) - Data structures

---

**Status**: ✅ Quickstart guide complete, ready for development.
