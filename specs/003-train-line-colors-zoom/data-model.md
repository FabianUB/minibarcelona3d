# Data Model: Enhanced Train Spatial Separation and Zoom-Responsive Sizing

**Feature**: 003-train-line-colors-zoom
**Date**: 2025-11-10
**Status**: Complete

## Overview

This document defines the data structures, entity extensions, and relationships required for implementing zoom-responsive spatial separation, train sizing, and hover outline functionality.

**Context**: Railway lines already have colors. Trains need enhanced spatial separation at high zoom and consistent sizing across zoom levels.

## Entity Modifications

### Extended: TrainMeshData

**Location**: `apps/web/src/lib/trains/trainMeshManager.ts:33-49`

**Current Structure** (existing fields):
```typescript
interface TrainMeshData {
  mesh: THREE.Group;                    // Three.js model instance
  vehicleKey: string;                   // Unique train identifier
  routeId: string;                      // Route ID (e.g., "R1_MOLINS_MACANET")
  currentPosition: [number, number];    // [lng, lat]
  targetPosition: [number, number];     // [lng, lat] for interpolation
  lastUpdate: number;                   // Timestamp of last position update
  interpolationDuration: number;        // Animation duration (ms)
  currentSnap?: RailwaySnapState;       // Snapped position on railway line
  targetSnap?: RailwaySnapState;        // Target snap for interpolation
  lateralOffsetIndex: number;           // Offset bucket [0-4]
  baseScale: number;                    // Base model scale (world units)
  boundingCenterOffset: THREE.Vector3;  // Model bounding box center
  boundingRadius: number;               // Bounding sphere radius
  hasUnrealisticSpeed: boolean;         // Speed warning flag
  warningIndicator?: THREE.Sprite;      // Visual warning sprite
}
```

**New Fields**:
```typescript
interface TrainMeshData {
  // ... existing fields ...

  // New: Zoom-responsive scaling
  screenSpaceScale: number;             // Current zoom-responsive multiplier
  lastZoomBucket: number;               // Quantized zoom (for cache invalidation)

  // New: Hover outline system
  outlineMesh?: THREE.Group;            // Duplicate geometry for outline effect
  lineCode?: string;                    // Cached line code (e.g., "R1", "R2N")
  lineColor?: THREE.Color;              // Cached line color for outline
}
```

**Field Descriptions**:

| Field | Type | Purpose | Computed When |
|-------|------|---------|---------------|
| `screenSpaceScale` | number | Current scale multiplier (0.48 - 1.6 range) | Per-frame or zoom change |
| `lastZoomBucket` | number | Quantized zoom level (0.1 increments) for cache | Per-frame |
| `outlineMesh` | THREE.Group | Duplicate geometry with BackSide material for outline | Train creation |
| `lineCode` | string | Line identifier extracted from routeId (e.g., "R1") | Train creation |
| `lineColor` | THREE.Color | Cached color instance for outline (lazy-loaded) | First hover |

**Validation Rules**:
- `screenSpaceScale`: Clamped to [0.48, 1.6] range (12px-40px / 25px target)
- `lastZoomBucket`: Rounded to nearest 0.1 (e.g., 10.234 → 10.2)
- `lineCode`: Optional - matches pattern `/^[A-Z]{1,3}[0-9]{1,2}[A-Z]?$/` if present
- `outlineMesh`: Initially undefined, created on first hover for performance
- `lineColor`: Lazy-loaded from RodaliesLine data on first hover

**Relationships**:
- `lineCode` → `RodaliesLine.short_code` (lookup via existing data loader)
- `routeId` → `lineCode` (extraction via `extractLineFromRouteId()`)
- `outlineMesh` → `mesh` (parent-child relationship for transform sync)

---

### Unchanged: RodaliesLine

**Location**: `apps/web/src/types/rodalies.ts:9-17`

**Structure**:
```typescript
export interface RodaliesLine {
  id: string;                   // Full line ID (e.g., "R1")
  name: string;                 // Display name (e.g., "Molins de Rei - Maçanet-Massanes")
  short_code: string;           // Short code (e.g., "R1") - used for color lookup
  brand_color: string;          // Hex color WITHOUT # prefix (e.g., "7DBCEC")
  default_pattern: LinePattern; // SVG pattern ID for map lines
  high_contrast_pattern: LinePattern; // High contrast SVG pattern ID
  order?: number;               // Display order in legend
}
```

**No Changes Needed**: Existing structure already contains all required data.

**Usage**:
- `short_code`: Matched against `TrainMeshData.lineCode` for hover outline color
- `brand_color`: Converted to THREE.Color via `new THREE.Color(`#${brand_color}`)` for outline

**Data Source**: `apps/web/public/rodalies_data/RodaliesLine.json`

---

## New Entities

### ScaleConfig

**Location**: `apps/web/src/lib/trains/scaleManager.ts` (new file)

**Purpose**: Encapsulates zoom-responsive scale computation and caching.

**Structure**:
```typescript
export interface ScaleConfig {
  minHeightPx: number;      // 12 (min screen-space height)
  maxHeightPx: number;      // 40 (max screen-space height)
  targetHeightPx: number;   // 25 (target at reference zoom)
  referenceZoom: number;    // 10 (calibration zoom level)
  zoomBucketSize: number;   // 0.1 (cache quantization)
}

export interface ScaleCache {
  cache: Map<number, number>;  // zoomBucket → scaleMultiplier
  invalidate(): void;
}
```

**Lifecycle**:
1. **Initialization**: `new ScaleManager(config: ScaleConfig)`
2. **Computation**: `scaleManager.computeScale(zoom: number): number`
3. **Cache hit**: Return cached value (>99% of calls)
4. **Cache miss**: Compute scale, store in cache, return
5. **Invalidation**: `scaleManager.invalidateCache()` (manual or on config change)

**Computation Formula**:
```typescript
function computeScale(zoom: number, config: ScaleConfig): number {
  const zoomDelta = zoom - config.referenceZoom;
  const baseMultiplier = Math.pow(0.5, zoomDelta);

  const minMultiplier = config.minHeightPx / config.targetHeightPx;  // 0.48
  const maxMultiplier = config.maxHeightPx / config.targetHeightPx;  // 1.6

  return Math.max(minMultiplier, Math.min(maxMultiplier, baseMultiplier));
}
```

**Cache Characteristics**:
- Zoom range: 5-17 (12 levels)
- Bucket size: 0.1
- Total buckets: 121
- Memory: 121 entries × 8 bytes = 968 bytes

---

### LateralOffsetConfig

**Location**: `apps/web/src/lib/trains/trainMeshManager.ts:84` (existing, modified)

**Purpose**: Configures spatial separation for co-located trains with zoom-responsive behavior.

**Current Constants** (to be replaced):
```typescript
private readonly LATERAL_OFFSET_BUCKETS = 5;
private readonly LATERAL_OFFSET_STEP_METERS = 1.6;
```

**Modified** (instance properties for zoom-responsive behavior):
```typescript
export interface LateralOffsetConfig {
  buckets: number;           // 5 (number of offset positions)
  baseStepMeters: number;    // 1.6 (base offset distance)
  highZoomThreshold: number; // 14 (zoom level to increase offset)
  highZoomMultiplier: number; // 1.5 (multiplier for zoom > threshold)
}
```

**Computation**:
```typescript
function computeLateralOffset(
  lateralOffsetIndex: number,
  zoom: number,
  config: LateralOffsetConfig
): number {
  const offsetMultiplier = lateralOffsetIndex - 2; // [-2, -1, 0, 1, 2]
  const zoomFactor = zoom > config.highZoomThreshold
    ? config.highZoomMultiplier
    : 1.0;

  return config.baseStepMeters * offsetMultiplier * zoomFactor;
}
```

**Example Values**:

| Zoom | Offset Index | Base (1.6m) | Enhanced (2.4m) |
|------|--------------|-------------|-----------------|
| 10   | 0 (center)   | 0m          | 0m              |
| 10   | 2 (right)    | +1.6m       | +1.6m           |
| 15   | 0 (center)   | 0m          | 0m              |
| 15   | 2 (right)    | +1.6m       | +2.4m           |
| 15   | 4 (far right)| +3.2m       | +4.8m           |

---

### OutlineConfig

**Location**: `apps/web/src/lib/trains/outlineManager.ts` (new file)

**Purpose**: Configuration for hover outline system.

**Structure**:
```typescript
export interface OutlineConfig {
  scaleFactor: number;        // 1.05 (5% larger than base mesh)
  opacity: number;            // 0.8 (outline transparency)
  fallbackColor: string;      // "CCCCCC" (for unmapped routes)
}

export interface OutlineMeshData {
  outlineGroup: THREE.Group;  // Container for outline meshes
  lineColor: THREE.Color;     // Color from RodaliesLine
  visible: boolean;           // Current visibility state
}
```

**Lifecycle**:
1. **Lazy Creation**: Outline mesh created on first hover (not at train creation)
2. **Show**: `outlineMesh.visible = true` on hover enter
3. **Hide**: `outlineMesh.visible = false` on hover leave
4. **Cleanup**: Removed when train mesh is removed from scene

**Memory Optimization**:
- Outlines created only when needed (lazy initialization)
- Shared geometry references (geometry.clone() only duplicates metadata, not vertex data)
- Total memory: ~100KB for 50 hovered trains (not all 100 trains)

---

## Data Flow Diagrams

### Spatial Separation Flow

```
TrainMeshManager.updateTrainMeshes(trains)
  │
  └─> For each train:
      ├─> lateralOffsetIndex = hash(vehicleKey) % 5
      │
      ├─> map.getZoom() → currentZoom
      │
      ├─> computeLateralOffset(lateralOffsetIndex, currentZoom)
      │   ├─> offsetMultiplier = index - 2  (center at index 2)
      │   ├─> zoomFactor = (zoom > 14) ? 1.5 : 1.0
      │   └─> offset = 1.6m * offsetMultiplier * zoomFactor
      │
      └─> Apply offset perpendicular to bearing
          └─> position = snapPosition + (perpVector × offset)
```

### Scale Computation Flow

```
TrainLayer3D.customLayer.render()  [every frame]
  │
  ├─> map.getZoom() → currentZoom
  │
  ├─> ScaleManager.computeScale(currentZoom)
  │   ├─> Quantize zoom to bucket (round to 0.1)
  │   ├─> Check cache
  │   │   ├─> HIT: Return cached multiplier
  │   │   └─> MISS: Compute, store, return
  │   └─> Return scaleMultiplier [0.48 - 1.6]
  │
  └─> For each visible train:
      ├─> finalScale = baseScale * randomVariation * scaleMultiplier
      ├─> mesh.scale.set(finalScale, finalScale, finalScale)
      └─> trainMeshData.screenSpaceScale = scaleMultiplier
```

### Hover Outline Flow

```
TrainLayer3D.handlePointerMove(event)
  │
  ├─> resolveScreenHit(point) → vehicleKey or null
  │
  ├─> IF vehicleKey changed:
  │   │
  │   ├─> Hide previous outline:
  │   │   └─> previousMeshData.outlineMesh.visible = false
  │   │
  │   └─> Show new outline:
  │       ├─> IF outlineMesh not created:
  │       │   ├─> Extract lineCode from routeId
  │       │   ├─> Lookup brand_color from RodaliesLine
  │       │   ├─> Create outline mesh with lineColor
  │       │   └─> Store in meshData.outlineMesh
  │       │
  │       └─> outlineMesh.visible = true
  │
  └─> Update hover state for hit detection
```

---

## State Management

### TrainMeshManager Internal State

**Current State**:
```typescript
private trainMeshes: Map<string, TrainMeshData>;  // vehicleKey → mesh data
private scene: THREE.Scene;
private stationMap: Map<string, Station>;
private railwayLines: Map<string, PreprocessedRailwayLine>;
```

**New State**:
```typescript
// Add to TrainMeshManager class
private scaleManager: ScaleManager;                    // NEW: Zoom scale computation
private lateralOffsetConfig: LateralOffsetConfig;      // NEW: Enhanced offset config
private outlineConfig: OutlineConfig;                  // NEW: Hover outline config
private rodaliesLines: Map<string, RodaliesLine>;      // NEW: Line color lookup
private currentZoom: number;                           // NEW: Cached current zoom level
```

**Initialization**:
```typescript
constructor(
  scene: THREE.Scene,
  stations: Station[],
  railways: Map<string, PreprocessedRailwayLine>,
  scaleConfig: ScaleConfig,                  // NEW parameter
  lateralOffsetConfig?: LateralOffsetConfig, // NEW optional parameter
  outlineConfig?: OutlineConfig              // NEW optional parameter
) {
  this.scene = scene;
  this.stationMap = new Map(stations.map(s => [s.id, s]));
  this.railwayLines = railways;
  this.scaleManager = new ScaleManager(scaleConfig);  // NEW
  this.lateralOffsetConfig = lateralOffsetConfig ?? getDefaultLateralOffsetConfig();  // NEW
  this.outlineConfig = outlineConfig ?? getDefaultOutlineConfig();  // NEW
  this.rodaliesLines = new Map();  // NEW (populated on demand)
  this.currentZoom = 10;  // NEW (updated in render loop)
}
```

---

## Validation & Error Handling

### Scale Computation Validation

**Scenario**: Zoom level outside expected range (5-17)
- **Cause**: User manually set zoom or browser zoom
- **Detection**: `zoom < 5` or `zoom > 17`
- **Handling**: Clamp scale to [minMultiplier, maxMultiplier], no error

**Scenario**: Scale computation returns NaN/Infinity
- **Cause**: Math error (e.g., division by zero)
- **Detection**: `!Number.isFinite(scaleMultiplier)`
- **Handling**: Fallback to 1.0 (neutral scale), log error

### Lateral Offset Validation

**Scenario**: Offset index out of bounds
- **Cause**: Hash function error or config change
- **Detection**: `index < 0` or `index >= LATERAL_OFFSET_BUCKETS`
- **Handling**: Clamp to [0, LATERAL_OFFSET_BUCKETS - 1], log warning

### Outline System Validation

**Scenario**: Route ID cannot be mapped to line code
- **Cause**: Unmapped route (e.g., "UNKNOWN_ROUTE_123")
- **Detection**: `extractLineFromRouteId(routeId)` returns null/undefined
- **Handling**: Use fallback color (#CCCCCC), log warning

**Scenario**: Line code not found in RodaliesLine data
- **Cause**: Data inconsistency (route references non-existent line)
- **Detection**: Line lookup returns undefined
- **Handling**: Use fallback color, log warning

---

## Performance Characteristics

| Operation | Frequency | Cost | Memory |
|-----------|-----------|------|--------|
| Scale computation (cached) | Once per zoom change | 0.001ms | +8 bytes/train |
| Scale computation (miss) | ~1% of zoom changes | 0.15ms | - |
| Lateral offset computation | Once per train update (30s) | <0.01ms | +0 bytes (modifies position) |
| Outline mesh creation | Once per first hover | 1ms | +2KB/train |
| Outline visibility toggle | Once per hover event | <0.01ms | +0 bytes |

**Total Memory Overhead**: ~10 bytes per train (without hover outline)
- `screenSpaceScale`: 8 bytes (number)
- `lastZoomBucket`: 8 bytes (number)
- `lineCode`: ~8 bytes (string ref, lazy)
- `lineColor`: ~12 bytes (THREE.Color, lazy)
- `outlineMesh`: ~2KB per train (lazy, only when hovered)

**For 100 trains**:
- Base: 10 bytes × 100 = 1 KB (negligible)
- With 10 hovered trains: 1 KB + (2KB × 10) = 21 KB (acceptable)

---

## Testing Considerations

### Unit Test Scenarios

1. **ScaleManager**:
   - Compute correct scale at zoom 5, 10, 15, 17
   - Clamp to [0.48, 1.6] range
   - Cache hit returns same value
   - Cache invalidation works

2. **LateralOffsetComputation**:
   - Offset = 0 at center index (2)
   - Offset increases at high zoom (>14)
   - Offset range: [-3.2m, +3.2m] at low zoom, [-4.8m, +4.8m] at high zoom

3. **OutlineManager**:
   - Create outline mesh with correct color
   - Fallback to #CCCCCC for unmapped routes
   - Visibility toggle works correctly
   - Lazy creation (not created until first hover)

### Integration Test Scenarios

1. **TrainMeshManager + ScaleManager**:
   - Render at zoom 5, 10, 17
   - Measure actual screen-space height (should be 12-40px)
   - Verify smooth transition when zooming

2. **TrainMeshManager + LateralOffset**:
   - Place 5 trains at same location
   - Zoom from 10 to 17
   - Verify separation increases smoothly

3. **End-to-End**:
   - Load map with 100 trains
   - Zoom from 5 to 17
   - Hover over trains
   - Verify scale, offset, and outline work together
   - Measure FPS (target: 30+)

---

**Status**: ✅ Data model complete, ready for implementation.
