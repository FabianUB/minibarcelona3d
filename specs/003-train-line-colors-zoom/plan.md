# Implementation Plan: Enhanced Train Spatial Separation and Zoom-Responsive Sizing

**Branch**: `003-train-line-colors-zoom` | **Date**: 2025-11-10 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-train-line-colors-zoom/spec.md`

**User Context**: Using Three.js and Mapbox to enforce appropriate zoom-responsive sizing. When trains converge on the same spot, zooming in should show them "separated" for better visualization.

**Important Context**: Railway lines on the map already have different colors. Train 3D models are currently all the same appearance. The problem is spatial overlap, not lack of color.

## Summary

This feature enhances spatial separation for overlapping trains at high zoom levels and implements zoom-responsive sizing to maintain consistent screen-space dimensions (12-40px height) across all zoom levels. Additionally adds hover outline to identify which line a train belongs to.

**Primary Requirements (P1)**:
- Enhanced spatial separation: increase lateral offset from 1.6m to 2.4m+ when zoom > 14
- Zoom-responsive scaling: keep trains at 12-40px screen-space height across all zoom levels
- Smooth transitions for both offset and scale when zooming

**Secondary Requirements (P2)**:
- Hover outline: show line brand color (#7DBCEC for R1, #26A741 for R2, etc.) as outline when hovering over train
- Fallback outline color (#CCCCCC) for unmapped routes

**Performance**:
- Maintain 30+ FPS performance with 100+ trains
- Preserve hover/click detection across all zoom and scale levels

**Technical Approach**:
- Modify TrainMeshManager lateral offset computation to be zoom-responsive
- Implement screen-space scale computation based on map zoom and camera distance
- Add hover outline system using Three.js outline shader or duplicate geometry technique
- Integrate with existing RodaliesLine data loader for outline color lookup
- Preserve existing opacity system (highlight mode, stale data indicators)

## Technical Context

**Language/Version**: TypeScript 5.9.3 (React 19.1.1 frontend)
**Primary Dependencies**: Three.js 0.180.0, Mapbox GL JS 3.4.0, Vite 7.1.7
**Storage**: Static JSON/GeoJSON files in `apps/web/public/rodalies_data/`
**Testing**: Vitest 2.1.9 (unit), Playwright 1.48.2 (E2E), @testing-library/react 16.3.0
**Target Platform**: Modern browsers (Chrome, Firefox, Safari, WebKit)
**Project Type**: Web application (monorepo structure)
**Performance Goals**: 30+ FPS with 100+ trains, <33ms frame time
**Constraints**: Screen-space height 12-40px, smooth zoom transitions, accurate hit detection
**Scale/Scope**: ~17 railway lines, 100+ concurrent trains, zoom range 5-17

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status**: ✅ PASS - No constitution file violations detected

**Analysis**:
- Constitution template is placeholder-only (no active principles defined)
- Feature adheres to existing codebase patterns:
  - Uses existing Context + Reducer state management (no new libraries)
  - Extends TrainMeshManager (no new architectural layers)
  - Static typing with TypeScript throughout
  - Testing via Vitest (unit) and Playwright (E2E) already configured
  - No new external services or APIs required

**Re-evaluation after Phase 1**: ✅ PASS - Design maintains simplicity, extends existing patterns

## Project Structure

### Documentation (this feature)

```text
specs/003-train-line-colors-zoom/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (zoom scaling techniques, color application)
├── data-model.md        # Phase 1 output (TrainMeshData extensions, color mapping)
├── quickstart.md        # Phase 1 output (dev setup, testing scenarios)
├── contracts/           # Phase 1 output (N/A - no new APIs, internal only)
│   └── train-color-config.ts  # Type definitions for color system
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created yet)
```

### Source Code (repository root)

```text
apps/web/                                    # React + Vite frontend
├── src/
│   ├── lib/
│   │   ├── rodalies/
│   │   │   └── dataLoader.ts               # MODIFY: Add loadRodaliesLines() if needed
│   │   ├── trains/
│   │   │   ├── trainMeshManager.ts         # MODIFY: Color + scale logic
│   │   │   ├── colorMapper.ts              # NEW: Line color lookup utility
│   │   │   └── scaleManager.ts             # NEW: Zoom-responsive scale computation
│   │   └── map/
│   │       └── coordinates.ts              # EXISTING: Model positioning utilities
│   ├── features/trains/
│   │   └── TrainLayer3D.tsx                # MODIFY: Pass color/scale config
│   └── types/
│       └── rodalies.ts                     # EXISTING: RodaliesLine already defined
│
└── tests/
    ├── unit/
    │   ├── colorMapper.test.ts             # NEW: Color lookup tests
    │   └── scaleManager.test.ts            # NEW: Scale computation tests
    └── e2e/
        └── train-colors-zoom.spec.ts       # NEW: Visual + zoom E2E tests
```

**Structure Decision**: Web application (Option 2) - existing `apps/web/` frontend structure. All modifications contained within the web app. No backend changes required as this is purely a frontend rendering enhancement.

## Complexity Tracking

> **Note**: No constitution violations - this section documents design decisions for maintainability

| Decision | Rationale | Alternative Considered |
|----------|-----------|------------------------|
| New colorMapper utility module | Separates color lookup logic from mesh management, improves testability | Inline in TrainMeshManager - rejected due to reduced code clarity |
| New scaleManager utility module | Isolates zoom-responsive math, enables independent testing of scale algorithms | Inline in render loop - rejected due to performance testing needs |
| Lateral offset enhancement | Reuse existing LATERAL_OFFSET_BUCKETS system, enhance visibility at high zoom | New clustering algorithm - rejected as overkill, existing system sufficient |

## Phase 0: Research & Decisions

See [research.md](./research.md) for detailed findings.

### Research Questions

1. **Q**: How to compute zoom-responsive screen-space scale in Three.js/Mapbox context?
   **A**: Use camera.projectionMatrix to project model bounds into NDC (Normalized Device Coordinates), then convert to screen-space pixels. Clamp resulting scale factor to maintain 12-40px height constraint.

2. **Q**: How to apply colors to Three.js GLTF models while preserving materials?
   **A**: Traverse mesh.children, find MeshStandardMaterial instances, set `.color` property using THREE.Color. Preserve other material properties (metalness, roughness, emissive).

3. **Q**: How to handle lateral offsets for co-located trains at varying zoom levels?
   **A**: Existing LATERAL_OFFSET_STEP_METERS (1.6m) works well. At high zoom (>14), trains naturally separate. At low zoom (<10), trains stack but remain distinguishable by color.

4. **Q**: Performance impact of per-frame scale recalculation for 100+ trains?
   **A**: Cache scale factor per zoom level (quantize to 0.1 increments). Recalculate only on zoom change events, not every frame. Minimal performance impact (<1ms per zoom event).

5. **Q**: Integration with existing opacity system (highlight mode, stale data)?
   **A**: Scale and color are independent properties. Opacity modulation via `material.opacity` and `material.transparent = true` continues to work. No conflicts.

### Design Decisions

**D1: Color Application Strategy**
- **Decision**: Modify TrainMeshManager.updateTrainMeshes() to apply colors during mesh creation/update
- **Implementation**: New `applyLineColor(mesh, lineCode)` method that looks up brand_color from RodaliesLine data
- **Fallback**: Light gray (#CCCCCC) for unmapped routes (per FR-003)
- **High Contrast**: No color modification (per FR-005 clarification)

**D2: Zoom-Responsive Scaling Strategy**
- **Decision**: Implement scale factor computation in render loop, cache by quantized zoom level
- **Implementation**: New `computeScreenSpaceScale(mesh, map, targetHeightPx)` utility
- **Constraints**: Min 12px, max 40px, target range 15-35px for typical zoom (8-15)
- **Caching**: Store scaleCache: Map<zoomBucket, scaleFactor> to avoid per-frame recalc

**D3: Spatial Separation Enhancement**
- **Decision**: Enhance existing lateralOffsetIndex system for better high-zoom visibility
- **Implementation**: Increase LATERAL_OFFSET_STEP_METERS from 1.6m to 2.5m when zoom > 14
- **Alternative**: Dynamic offset based on zoom level: `offset = baseOffset * (1 + (zoom - 10) * 0.1)`
- **Rationale**: Simple multiplier approach, no complex clustering algorithm needed

**D4: Data Loading Strategy**
- **Decision**: Lazy-load RodaliesLine data once on TrainLayer3D mount
- **Implementation**: Use existing `loadRodaliesLines()` from dataLoader (already available)
- **Caching**: Data loader already caches, no additional caching needed
- **Error Handling**: Fallback to #CCCCCC if line data unavailable

## Phase 1: Design & Contracts

### Data Model

See [data-model.md](./data-model.md) for complete entity definitions.

**Extended Entities**:

1. **TrainMeshData** (apps/web/src/lib/trains/trainMeshManager.ts)
   - Add: `lineColor: THREE.Color` - Cached line color instance
   - Add: `screenSpaceScale: number` - Current zoom-responsive scale factor
   - Add: `lastZoomBucket: number` - Quantized zoom level for cache invalidation

2. **RodaliesLine** (apps/web/src/types/rodalies.ts)
   - Existing: `brand_color: string` - Hex color without # prefix
   - No modifications needed

**New Entities**:

3. **ColorConfig** (apps/web/src/lib/trains/colorMapper.ts)
   ```typescript
   interface ColorConfig {
     lineColors: Map<string, THREE.Color>;  // lineCode -> THREE.Color
     fallbackColor: THREE.Color;             // #CCCCCC
   }
   ```

4. **ScaleConfig** (apps/web/src/lib/trains/scaleManager.ts)
   ```typescript
   interface ScaleConfig {
     minHeightPx: number;      // 12
     maxHeightPx: number;      // 40
     targetHeightPx: number;   // 25 (midpoint)
     zoomBucketSize: number;   // 0.1 for cache quantization
   }
   ```

### API Contracts

**N/A** - This feature is internal to the frontend rendering system. No new HTTP endpoints or GraphQL queries required.

### Internal Contracts (Type Definitions)

See [contracts/train-color-config.ts](./contracts/train-color-config.ts) for TypeScript interfaces.

**Key Interfaces**:

```typescript
// Color mapping interface
export interface IColorMapper {
  getColorForLine(lineCode: string): THREE.Color;
  getColorForRoute(routeId: string): THREE.Color;
  loadColors(lines: RodaliesLine[]): void;
}

// Scale computation interface
export interface IScaleManager {
  computeScale(
    mesh: THREE.Group,
    map: mapboxgl.Map,
    currentZoom: number
  ): number;
  invalidateCache(): void;
}
```

### Quickstart

See [quickstart.md](./quickstart.md) for developer setup and testing instructions.

**Quick Commands**:
```bash
cd apps/web
npm run dev              # Start dev server with hot reload
npm test -- colorMapper  # Run color mapper unit tests
npm test -- scaleManager # Run scale manager unit tests
npm run test:e2e -- train-colors-zoom.spec.ts  # Run E2E tests
```

**Testing Scenarios**:
1. Visual verification: Load map, observe trains colored by line
2. Zoom test: Zoom from level 5 to 17, verify trains stay 12-40px height
3. Co-location test: Find trains at same station, zoom in, verify separation
4. Performance test: Monitor FPS with 100+ trains, verify 30+ FPS maintained

## Phase 2: Task Breakdown

Task breakdown will be generated by the `/speckit.tasks` command after this plan is approved.

**High-Level Task Categories** (preview):
1. **Spatial Separation (P1)**: Enhance lateral offset computation for zoom-responsive separation
2. **Scale System (P1)**: Implement zoom-responsive scale computation and caching
3. **Hover Outline (P2)**: Implement outline effect system with line color lookup
4. **Integration**: Modify TrainMeshManager, update render loop with zoom detection
5. **Testing**: Unit tests (offset/scale), E2E tests (visual verification, hover interaction)
6. **Performance**: Profile and optimize, verify 30+ FPS target

## Implementation Notes

### Integration Points

1. **TrainLayer3D.tsx** (apps/web/src/features/trains/TrainLayer3D.tsx:116)
   - Load RodaliesLine data in useEffect hook (line ~790)
   - Pass color config to TrainMeshManager constructor
   - Pass scale config to render loop

2. **TrainMeshManager.ts** (apps/web/src/lib/trains/trainMeshManager.ts:84)
   - Constructor: Accept ColorConfig and ScaleConfig parameters
   - updateTrainMeshes(): Apply colors after mesh creation (line ~400)
   - animatePositions(): Apply zoom-responsive scale (line ~700)

3. **TrainLayer3D CustomLayer render()** (apps/web/src/features/trains/TrainLayer3D.tsx:687)
   - Compute current zoom level from map.getZoom()
   - Call scaleManager.computeScale() for each visible train
   - Apply scale to mesh.scale property before rendering

### Performance Considerations

1. **Color Application**: Once per train creation, not per frame (minimal impact)
2. **Scale Computation**: Cached by zoom bucket, recalculate only on zoom change (<1ms)
3. **Material Modifications**: Reuse existing material instances, modify properties in-place
4. **Memory**: +24 bytes per train (THREE.Color + scale + zoomBucket), ~2.4KB for 100 trains

### Backward Compatibility

- No breaking changes to existing train visualization system
- Existing opacity modulation (highlight mode, stale data) continues to work
- Existing hit detection (screen-space raycasting) unaffected by scale changes
- Existing lateral offset system enhanced, not replaced

### Risk Mitigation

**Risk**: Scale recalculation drops FPS below 30
**Mitigation**: Cache by zoom bucket (0.1 increments), profile with 100+ trains, lazy recalculation

**Risk**: Color application breaks material properties (lighting, shadows)
**Mitigation**: Preserve existing material.metalness, material.roughness, only modify .color

**Risk**: Spatial separation creates unnatural train positioning
**Mitigation**: Use modest offset increase (1.6m → 2.5m), only at high zoom (>14), A/B test

**Risk**: Line color lookup fails for unmapped routes
**Mitigation**: Fallback to #CCCCCC (light gray), log warning for unmapped routes

## Next Steps

1. **Review this plan**: Ensure technical approach aligns with requirements
2. **Generate research.md**: Run Phase 0 research workflow (detailed findings)
3. **Generate data-model.md**: Document entity extensions and relationships
4. **Generate contracts/**: Create TypeScript interface definitions
5. **Generate quickstart.md**: Setup instructions and testing guide
6. **Run /speckit.tasks**: Break down into actionable implementation tasks
