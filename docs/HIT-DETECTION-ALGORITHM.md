# Hit Detection Algorithm (OBR - Oriented Bounding Rectangle)

This document explains how MiniBarcelona3D detects clicks and hovers on 3D vehicle meshes. The system uses an Oriented Bounding Rectangle (OBR) approach that projects 3D bounding boxes to 2D screen space for efficient point-in-rectangle testing.

## Table of Contents

1. [Overview](#1-overview)
2. [Why OBR Instead of Raycasting](#2-why-obr-instead-of-raycasting)
3. [Architecture](#3-architecture)
4. [Coordinate Systems](#4-coordinate-systems)
5. [OBR Calculation](#5-obr-calculation)
6. [Point-in-Rectangle Test](#6-point-in-rectangle-test)
7. [Integration with Mesh Managers](#7-integration-with-mesh-managers)
8. [Visual Feedback](#8-visual-feedback)
9. [Key Files Reference](#9-key-files-reference)
10. [Performance Optimizations](#10-performance-optimizations)
11. [Debug Visualization](#11-debug-visualization)

---

## 1. Overview

### The Problem

How do you detect when a user clicks on a 3D train model rendered on a Mapbox map?

Standard 3D raycasting would require:
- Unprojecting screen coordinates to a 3D ray
- Testing the ray against mesh geometry
- Complex camera matrix calculations in Mapbox's coordinate system

### The Solution: OBR

Instead of raycasting in 3D, we:

1. **Project** each vehicle's 3D bounding box to 2D screen coordinates
2. **Create** an Oriented Bounding Rectangle (OBR) that accounts for vehicle rotation
3. **Test** if the click point is inside this 2D rotated rectangle
4. **Select** the nearest vehicle when multiple overlap

This approach is:
- **Simple**: 2D point-in-rectangle test (basic geometry)
- **Fast**: No per-vertex mesh intersection
- **Accurate**: Accounts for actual vehicle dimensions and rotation
- **Robust**: Works with any camera projection/angle

---

## 2. Why OBR Instead of Raycasting

### Standard 3D Raycasting

```
Screen Click (x, y)
       ↓
Unproject to 3D Ray (origin + direction)
       ↓
For each mesh:
  - Transform ray to model space
  - Test ray against every triangle
  - Find closest intersection
       ↓
Return hit mesh
```

**Problems:**
- Requires access to mesh geometry
- Computationally expensive for complex models
- Complex matrix math with Mapbox's custom projection
- Three.js raycaster doesn't integrate well with Mapbox Custom Layers

### OBR Approach

```
Screen Click (x, y)
       ↓
For each vehicle:
  - Get 3D position + rotation
  - Project bounding box corners to screen
  - Create 2D rotated rectangle
  - Simple point-in-rectangle test
       ↓
Return nearest hit
```

**Advantages:**
- Works entirely in 2D screen space
- O(1) per vehicle (no geometry traversal)
- Mapbox handles all projection math
- Naturally accounts for camera angle and zoom

---

## 3. Architecture

### Data Flow: Click to Selection

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     MOUSE EVENT (click/hover)                            │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     GET CANVAS COORDINATES                               │
│  point = { x: event.clientX - rect.left, y: event.clientY - rect.top }  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              meshManager.getScreenCandidates(map)                        │
│                                                                          │
│  For each vehicle mesh:                                                  │
│    1. Get mesh position (world space)                                    │
│    2. Convert to GPS coordinates (LngLat)                                │
│    3. Project to screen pixels (map.project)                             │
│    4. Get mesh quaternion (rotation/bearing)                             │
│    5. Transform local axes to world space                                │
│    6. Project extent points (front, right) to screen                     │
│    7. Calculate OBR dimensions and rotation                              │
│                                                                          │
│  Returns: ScreenSpaceCandidate[] with OBR data                           │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                resolveScreenHit(point, paddingPx)                        │
│                                                                          │
│  For each candidate:                                                     │
│    1. Translate click point relative to OBR center                       │
│    2. Rotate point to align with OBR local axes (inverse rotation)       │
│    3. Test if point is inside axis-aligned rectangle                     │
│    4. Calculate normalized distance from center                          │
│    5. Track nearest hit                                                  │
│                                                                          │
│  Returns: { vehicleKey, routeId, distance } or null                      │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        HANDLE SELECTION                                  │
│                                                                          │
│  Click: selectVehicle(data), open info panel                             │
│  Hover: setHighlightedVehicle(key), show outline, scale up               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Coordinate Systems

### The Coordinate Chain

```
GPS Coordinates (LngLat)
    │
    │  Mercator projection
    ▼
Mapbox Mercator Coordinates
    │
    │  Relative to model origin
    ▼
Three.js World Space (x, y, z)
    │
    │  mesh.quaternion (rotation)
    ▼
Three.js Object Space (rotated)
    │
    │  map.project() via Mapbox
    ▼
Screen Space (pixels on canvas)
```

### GPS to World Space

**File**: `apps/web/src/lib/map/coordinates.ts`

```typescript
// Model origin is set at map center for numerical precision
let modelOrigin: mapboxgl.MercatorCoordinate;

export function getModelPosition(
  lng: number,
  lat: number,
  altitude: number = 0
): { x: number; y: number; z: number } {
  // Convert GPS to Mapbox Mercator coordinates
  const coord = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], altitude);

  // Return position RELATIVE to model origin
  // CRITICAL: Y-axis is negated (Mapbox Y points south, Three.js Y points north)
  return {
    x: coord.x - modelOrigin.x,
    y: -(coord.y - modelOrigin.y),  // NEGATE Y
    z: coord.z - modelOrigin.z,
  };
}
```

### World Space to GPS

```typescript
export function getLngLatFromModelPosition(
  x: number,
  y: number,
  z: number = 0
): mapboxgl.LngLat {
  // Reverse transformation: world space → GPS
  const coord = new mapboxgl.MercatorCoordinate(
    modelOrigin.x + x,
    modelOrigin.y - y,  // NEGATE Y back
    modelOrigin.z + z
  );
  return coord.toLngLat();
}
```

### World Space to Screen Space

```typescript
// In getScreenCandidates():
const centerLngLat = getLngLatFromModelPosition(
  mesh.position.x,
  mesh.position.y,
  mesh.position.z
);

// Mapbox handles the projection (accounts for camera, zoom, pitch, etc.)
const centerPoint = map.project(centerLngLat);
// centerPoint = { x: pixelX, y: pixelY }
```

---

## 5. OBR Calculation

### Step 1: Get Bounding Box Half-Extents

When a mesh is created, we compute its bounding box **before rotation**:

**File**: `apps/web/src/lib/trains/trainMeshManager.ts`

```typescript
private createMesh(train: TrainPosition): void {
  const gltf = getCachedModel(modelType);
  const trainModel = gltf.scene.clone();

  // Compute bounding box BEFORE any rotation
  const boundingBox = new THREE.Box3().setFromObject(trainModel);
  const size = new THREE.Vector3();
  boundingBox.getSize(size);

  // Store half-extents in model space
  const boundingHalfExtents = new THREE.Vector3(
    size.x / 2,  // Half-length (along model X axis)
    size.y / 2,  // Half-width (along model Y axis)
    size.z / 2   // Half-height (along model Z axis)
  );

  // Store for later OBR calculation
  meshData.boundingHalfExtents = boundingHalfExtents;
}
```

### Step 2: Transform Local Axes to World Space

The mesh rotation (bearing) is stored as a quaternion. We use it to find where the model's local axes point in world space:

```typescript
// Model's local axes (before rotation)
const localXAxis = new THREE.Vector3(1, 0, 0);  // Points along length
const localYAxis = new THREE.Vector3(0, 1, 0);  // Points along width

// Apply mesh rotation to get world-space direction vectors
const worldX = localXAxis.clone().applyQuaternion(mesh.quaternion);
const worldY = localYAxis.clone().applyQuaternion(mesh.quaternion);
```

### Step 3: Project Extent Points to Screen

We project the mesh center and two extent points (front and right edges):

```typescript
// Scale half-extents by current mesh scale
const currentScale = mesh.scale.x;  // Uniform scaling
const worldHalfLength = boundingHalfExtents.x * currentScale;
const worldHalfWidth = boundingHalfExtents.y * currentScale;

// Project center point
const centerLngLat = getLngLatFromModelPosition(
  mesh.position.x,
  mesh.position.y,
  mesh.position.z
);
const centerPoint = map.project(centerLngLat);

// Project front edge (along length axis)
const frontLngLat = getLngLatFromModelPosition(
  mesh.position.x + worldX.x * worldHalfLength,
  mesh.position.y + worldX.y * worldHalfLength,
  mesh.position.z
);
const frontScreen = map.project(frontLngLat);

// Project right edge (along width axis)
const rightLngLat = getLngLatFromModelPosition(
  mesh.position.x + worldY.x * worldHalfWidth,
  mesh.position.y + worldY.y * worldHalfWidth,
  mesh.position.z
);
const rightScreen = map.project(rightLngLat);
```

### Step 4: Calculate OBR Dimensions

```typescript
// Half-length in screen pixels (distance from center to front)
const halfLengthPx = Math.max(
  Math.hypot(
    frontScreen.x - centerPoint.x,
    frontScreen.y - centerPoint.y
  ),
  20  // Minimum 20px for clickability
);

// Half-width in screen pixels (distance from center to right)
const halfWidthPx = Math.max(
  Math.hypot(
    rightScreen.x - centerPoint.x,
    rightScreen.y - centerPoint.y
  ),
  10  // Minimum 10px for clickability
);

// Screen-space rotation angle (radians)
const screenRotation = Math.atan2(
  frontScreen.y - centerPoint.y,
  frontScreen.x - centerPoint.x
);
```

### Visual Representation

```
3D World Space:                     Screen Space (after projection):

      Front (length axis)                    frontScreen
           ▲                                      ▲
           │                                      │ halfLengthPx
           │ halfLength                           │
     ┌─────┼─────┐                          ┌─────┼─────┐
     │     │     │                          │     │     │ ← rotated
Right├─────●─────┤                          ├─────●─────┤   rectangle
     │   center  │                          │ centerPt  │
     └───────────┘                          └─────┴─────┘
       halfWidth                               halfWidthPx
                                                  │
                                            rightScreen

screenRotation = atan2(front.y - center.y, front.x - center.x)
```

### Complete ScreenSpaceCandidate Structure

```typescript
interface ScreenSpaceCandidate {
  vehicleKey: string;
  routeId: string | null;
  screenPoint: { x: number; y: number };  // Center in screen pixels
  orientedRect: {
    halfLengthPx: number;   // Half-length in pixels
    halfWidthPx: number;    // Half-width in pixels
    rotation: number;       // Rotation angle in radians
  };
}
```

---

## 6. Point-in-Rectangle Test

### The Algorithm

To test if a click point is inside a rotated rectangle:

1. **Translate** the click point relative to rectangle center
2. **Rotate** the point by the inverse of the rectangle's rotation
3. **Test** against axis-aligned bounds

**File**: `apps/web/src/features/trains/TrainLayer3D.tsx`

```typescript
function resolveScreenHit(
  point: { x: number; y: number },
  paddingPx: number
): HitResult | null {
  const candidates = meshManager.getScreenCandidates(map);
  let nearest: HitResult | null = null;

  for (const candidate of candidates) {
    const { screenPoint, orientedRect, vehicleKey, routeId } = candidate;
    const { halfLengthPx, halfWidthPx, rotation } = orientedRect;

    // Add padding for easier clicking
    const paddedHalfLength = halfLengthPx + paddingPx;
    const paddedHalfWidth = halfWidthPx + paddingPx;

    // Step 1: Translate click point relative to rectangle center
    const dx = point.x - screenPoint.x;
    const dy = point.y - screenPoint.y;

    // Step 2: Rotate point by INVERSE of rectangle rotation
    // This aligns the point with the rectangle's local axes
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);

    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    // Step 3: Test against axis-aligned bounds
    const isInside =
      Math.abs(localX) <= paddedHalfLength &&
      Math.abs(localY) <= paddedHalfWidth;

    if (isInside) {
      // Calculate normalized distance from center (0 = center, 1 = edge)
      const normalizedDistance = Math.sqrt(
        (localX / paddedHalfLength) ** 2 +
        (localY / paddedHalfWidth) ** 2
      );

      // Track nearest vehicle (for overlapping vehicles)
      if (!nearest || normalizedDistance < nearest.distance) {
        nearest = { vehicleKey, routeId, distance: normalizedDistance };
      }
    }
  }

  return nearest;
}
```

### The Math: 2D Rotation

Given a rectangle rotated by angle θ, to test if point P is inside:

```
1. Translate P to rectangle's local origin:
   P' = P - center

2. Apply inverse rotation (-θ) to align with rectangle axes:
   P'' = R(-θ) × P'

   Where R(-θ) = [ cos(θ)   sin(θ) ]
                 [ -sin(θ)  cos(θ) ]

   Expanded:
   P''.x = P'.x × cos(θ) - P'.y × sin(θ)
   P''.y = P'.x × sin(θ) + P'.y × cos(θ)

   Note: cos(-θ) = cos(θ), sin(-θ) = -sin(θ)

3. Test axis-aligned bounds:
   |P''.x| ≤ halfLength  AND  |P''.y| ≤ halfWidth
```

### Visual Walkthrough

```
BEFORE TRANSFORMATION:

                    Rectangle (rotated 45°)
                         ╱╲
                        ╱  ╲
                       ╱    ╲
                      ╱  ●   ╲  ← click point
                      ╲ center╱
                       ╲    ╱
                        ╲  ╱
                         ╲╱

STEP 1: Translate click to center
         click' = click - center

STEP 2: Inverse rotation (-45°)

                    ┌────────────┐
                    │            │  ← now axis-aligned
                    │    ●       │  ← click'' (rotated)
                    │  center    │
                    └────────────┘

STEP 3: Simple bounds test
         |click''.x| ≤ halfLength? YES
         |click''.y| ≤ halfWidth?  YES
         → INSIDE!
```

### Handling Overlapping Vehicles

When multiple vehicles overlap in screen space, we select the one closest to the click point:

```typescript
// Normalized distance: 0 at center, 1 at edge
const normalizedDistance = Math.sqrt(
  (localX / halfLength) ** 2 +
  (localY / halfWidth) ** 2
);

// Lower distance = closer to center = more likely intended target
if (!nearest || normalizedDistance < nearest.distance) {
  nearest = candidate;
}
```

---

## 7. Integration with Mesh Managers

### TrainMeshManager (Rodalies)

**File**: `apps/web/src/lib/trains/trainMeshManager.ts`

```typescript
class TrainMeshManager {
  private trainMeshes: Map<string, TrainMeshData>;

  /**
   * Get all vehicle meshes projected to screen space for hit testing.
   * Called on every mouse event.
   */
  getScreenCandidates(map: mapboxgl.Map): ScreenSpaceCandidate[] {
    const candidates: ScreenSpaceCandidate[] = [];

    for (const [vehicleKey, meshData] of this.trainMeshes) {
      const { mesh, boundingHalfExtents, routeId } = meshData;

      // Skip invisible meshes
      if (!mesh.visible) continue;

      // Project center to screen
      const centerLngLat = getLngLatFromModelPosition(
        mesh.position.x,
        mesh.position.y,
        mesh.position.z
      );
      const centerPoint = map.project(centerLngLat);

      // Transform local axes
      const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(mesh.quaternion);
      const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion);

      // Calculate world-space extents
      const currentScale = mesh.scale.x;
      const worldHalfLength = boundingHalfExtents.x * currentScale;
      const worldHalfWidth = boundingHalfExtents.y * currentScale;

      // Project extent points
      const frontLngLat = getLngLatFromModelPosition(
        mesh.position.x + localX.x * worldHalfLength,
        mesh.position.y + localX.y * worldHalfLength,
        mesh.position.z
      );
      const frontScreen = map.project(frontLngLat);

      const rightLngLat = getLngLatFromModelPosition(
        mesh.position.x + localY.x * worldHalfWidth,
        mesh.position.y + localY.y * worldHalfWidth,
        mesh.position.z
      );
      const rightScreen = map.project(rightLngLat);

      // Calculate OBR dimensions
      const halfLengthPx = Math.max(
        Math.hypot(frontScreen.x - centerPoint.x, frontScreen.y - centerPoint.y),
        20  // Minimum for clickability
      );

      const halfWidthPx = Math.max(
        Math.hypot(rightScreen.x - centerPoint.x, rightScreen.y - centerPoint.y),
        10
      );

      const screenRotation = Math.atan2(
        frontScreen.y - centerPoint.y,
        frontScreen.x - centerPoint.x
      );

      candidates.push({
        vehicleKey,
        routeId,
        screenPoint: { x: centerPoint.x, y: centerPoint.y },
        orientedRect: {
          halfLengthPx,
          halfWidthPx,
          rotation: screenRotation,
        },
      });
    }

    return candidates;
  }

  /**
   * Get the current rendered position of a vehicle (for zoom-to-vehicle).
   */
  getMeshLngLat(vehicleKey: string): [number, number] | null {
    const meshData = this.trainMeshes.get(vehicleKey);
    if (!meshData) return null;
    return meshData.currentPosition;
  }

  /**
   * Get number of active meshes (for performance monitoring).
   */
  getMeshCount(): number {
    return this.trainMeshes.size;
  }
}
```

### TransitMeshManager (Metro, Bus, Tram, FGC)

**File**: `apps/web/src/lib/transit/transitMeshManager.ts`

Same pattern with slightly different minimum dimensions:

```typescript
class TransitMeshManager {
  getScreenCandidates(map: mapboxgl.Map): ScreenSpaceCandidate[] {
    // Same algorithm as TrainMeshManager
    // Different minimum dimensions:
    const halfLengthPx = Math.max(..., 15);  // 15px minimum
    const halfWidthPx = Math.max(..., 8);    // 8px minimum
  }

  getVehiclePosition(vehicleKey: string): [number, number] | null {
    // Returns current [lng, lat] for zoom-to-vehicle
  }
}
```

---

## 8. Visual Feedback

### Hover Effects

When a vehicle is hovered, we provide visual feedback:

#### 1. Scale Up (12% larger)

```typescript
setHighlightedVehicle(vehicleKey?: string): void {
  // Clear previous highlight
  if (this.highlightedVehicleKey && this.highlightedVehicleKey !== vehicleKey) {
    const prevMesh = this.trainMeshes.get(this.highlightedVehicleKey);
    if (prevMesh) {
      const normalScale = prevMesh.baseScale * this.screenSpaceScale;
      prevMesh.mesh.scale.setScalar(normalScale);
    }
  }

  // Apply new highlight
  if (vehicleKey) {
    const meshData = this.trainMeshes.get(vehicleKey);
    if (meshData) {
      const highlightScale = meshData.baseScale * this.screenSpaceScale * 1.12;
      meshData.mesh.scale.setScalar(highlightScale);
    }
  }

  this.highlightedVehicleKey = vehicleKey;
}
```

#### 2. Show Outline

Outlines are lazily created on first hover:

```typescript
showOutline(vehicleKey: string): void {
  const meshData = this.trainMeshes.get(vehicleKey);
  if (!meshData) return;

  // Lazy creation
  if (!meshData.outlineMesh) {
    meshData.outlineMesh = createOutlineMesh(
      meshData.mesh,
      meshData.lineColor,     // Line-specific color
      this.getOutlineScale()  // Zoom-dependent (1.04-1.08)
    );
    meshData.mesh.add(meshData.outlineMesh);
  }

  meshData.outlineMesh.visible = true;
}

hideOutline(vehicleKey: string): void {
  const meshData = this.trainMeshes.get(vehicleKey);
  if (meshData?.outlineMesh) {
    meshData.outlineMesh.visible = false;
  }
}
```

#### 3. Cursor Change

```typescript
// In TrainLayer3D.tsx
const handleMouseMove = (event: MouseEvent) => {
  const hit = resolveScreenHit(point, 6);  // 6px padding for hover

  if (hit) {
    map.getCanvas().style.cursor = 'pointer';
    meshManager.setHighlightedVehicle(hit.vehicleKey);
    meshManager.showOutline(hit.vehicleKey);
  } else {
    map.getCanvas().style.cursor = '';
    meshManager.setHighlightedVehicle(undefined);
    meshManager.hideAllOutlines();
  }
};
```

### Click Actions

```typescript
const handleClick = (event: MouseEvent) => {
  const hit = resolveScreenHit(point, 4);  // 4px padding for click (stricter)

  if (hit) {
    // Fetch full vehicle data
    const trainData = await fetchTrainByKey(hit.vehicleKey);

    // Update selection state
    selectTrain(trainData);

    // Open info panel
    setActivePanel('trainInfo');

    // Optional: zoom to vehicle
    const position = meshManager.getMeshLngLat(hit.vehicleKey);
    if (position) {
      map.flyTo({ center: position, zoom: 15 });
    }
  }
};
```

---

## 9. Key Files Reference

### Core Hit Detection

| File | Purpose |
|------|---------|
| `apps/web/src/lib/trains/trainMeshManager.ts` | `getScreenCandidates()` for Rodalies |
| `apps/web/src/lib/transit/transitMeshManager.ts` | `getScreenCandidates()` for Metro/Bus/FGC/Tram |
| `apps/web/src/features/trains/TrainLayer3D.tsx` | `resolveScreenHit()` and click/hover handlers |
| `apps/web/src/features/transit/UnifiedTransitLayer3D.tsx` | Click/hover handlers for transit |
| `apps/web/src/lib/map/coordinates.ts` | Coordinate transformations |

### Visual Feedback

| File | Purpose |
|------|---------|
| `apps/web/src/lib/trains/outlineManager.ts` | `createOutlineMesh()` utility |
| `apps/web/src/lib/trains/trainMeshManager.ts` | `setHighlightedVehicle()`, `showOutline()` |

### Supporting Files

| File | Purpose |
|------|---------|
| `apps/web/src/lib/trains/modelLoader.ts` | Load and cache 3D models with bounding boxes |
| `apps/web/src/types/trains.ts` | `ScreenSpaceCandidate` interface |

---

## 10. Performance Optimizations

### 1. Throttled Mouse Move

Mouse move events are throttled to prevent excessive hit testing:

```typescript
const MOUSE_MOVE_THROTTLE_MS = 100;  // Max 10 FPS

const handleMouseMove = (event: MouseEvent) => {
  const now = Date.now();
  if (now - lastMouseMoveTime < MOUSE_MOVE_THROTTLE_MS) return;
  lastMouseMoveTime = now;

  // ... hit testing ...
};
```

### 2. Ref-Based Hover State

Hover state uses refs instead of React state to avoid re-renders:

```typescript
const hoveredVehicleRef = useRef<string | null>(null);

// No setState(), no re-render on hover
if (hoveredVehicleRef.current !== hit?.vehicleKey) {
  meshManager.setHighlightedVehicle(hit?.vehicleKey);
  hoveredVehicleRef.current = hit?.vehicleKey ?? null;
}
```

### 3. Lazy Outline Creation

Outline meshes are only created when first hovered:

```typescript
if (!meshData.outlineMesh) {
  // Create only on first hover
  meshData.outlineMesh = createOutlineMesh(...);
}
```

### 4. Cached Materials

Materials are cached on mesh creation to avoid traversal:

```typescript
interface TrainMeshData {
  // ...
  cachedMaterials: THREE.Material[];  // Cached for opacity updates
}

// On creation:
meshData.cachedMaterials = [];
mesh.traverse((child) => {
  if (child instanceof THREE.Mesh) {
    meshData.cachedMaterials.push(child.material);
  }
});
```

### 5. No Candidate Caching

Screen candidates are **not** cached because they must be recalculated on every camera movement. The calculation is O(n) per frame where n = active vehicles.

### Complexity Analysis

| Operation | Complexity | Notes |
|-----------|------------|-------|
| `getScreenCandidates()` | O(n) | n = active vehicles |
| `resolveScreenHit()` | O(n) | Linear scan of candidates |
| Point-in-OBR test | O(1) | Simple geometry |
| Total per mouse event | O(n) | Typically n < 500 |

---

## 11. Debug Visualization

### Enabling Debug Mode

Debug mode can be enabled via:
- URL parameter: `?debug`
- Keyboard shortcut: Type "toggledebug" on the map

### Debug Overlay

**File**: `apps/web/src/features/trains/TrainLayer3D.tsx`

```typescript
// Debug overlay draws all OBRs
const renderDebugOverlay = () => {
  const canvas = debugCanvasRef.current;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const candidates = meshManager.getScreenCandidates(map);

  for (const candidate of candidates) {
    const { screenPoint, orientedRect, vehicleKey } = candidate;
    const { halfLengthPx, halfWidthPx, rotation } = orientedRect;

    // Draw rotated rectangle
    ctx.save();
    ctx.translate(screenPoint.x, screenPoint.y);
    ctx.rotate(rotation);

    ctx.beginPath();
    ctx.rect(
      -halfLengthPx,
      -halfWidthPx,
      halfLengthPx * 2,
      halfWidthPx * 2
    );

    // Color: green if hovered, red otherwise
    const isHovered = vehicleKey === hoveredVehicleRef.current;
    ctx.strokeStyle = isHovered ? '#00ff00' : '#ff0000';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();

    // Draw center point
    ctx.beginPath();
    ctx.arc(screenPoint.x, screenPoint.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ffff00';
    ctx.fill();

    // Draw vehicle key label
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px monospace';
    ctx.fillText(vehicleKey, screenPoint.x + 5, screenPoint.y - 5);
  }
};
```

### Debug Output

```
┌─────────────────────────────────────────────┐
│                                             │
│    ┌────────┐                               │
│    │ R1-001 │  ← Red rectangle (not hovered)│
│    └────────┘                               │
│         ●  ← Yellow center point            │
│                                             │
│              ╱╲                             │
│             ╱  ╲  ← Green rectangle (hovered)│
│            ╱ R4 ╲                           │
│            ╲-023╱                           │
│             ╲  ╱                            │
│              ╲╱                             │
│               ●                             │
│                                             │
└─────────────────────────────────────────────┘
```

---

## Summary

The OBR hit detection system provides accurate click detection for 3D vehicles by:

1. **Projecting** 3D bounding boxes to 2D screen space
2. **Creating** Oriented Bounding Rectangles that account for vehicle rotation
3. **Testing** click points with simple 2D geometry
4. **Selecting** the nearest vehicle when multiple overlap

Key advantages:
- **Simple math**: 2D point-in-rectangle test
- **Fast**: O(n) complexity, no geometry traversal
- **Accurate**: Accounts for actual vehicle dimensions and bearing
- **Robust**: Works with any camera angle, zoom, or pitch
- **Integrated**: Uses Mapbox's projection for coordinate transforms

The system handles hundreds of vehicles at 60fps with minimal impact on performance.
