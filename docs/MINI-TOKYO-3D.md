# Mini Tokyo 3D - Technical Analysis

**Purpose**: Document how Mini Tokyo 3D correctly implements 3D vehicle models with Three.js and Mapbox GL JS

**Date**: 2025-10-27

**Project**: https://github.com/nagix/mini-tokyo-3d

---

## Overview

Mini Tokyo 3D is a real-time 3D digital map of Tokyo's public transport system. It successfully renders thousands of moving 3D vehicles (trains, buses, cars, aircraft) using Three.js integrated with Mapbox GL JS.

## Key Architecture Decisions

### 1. Coordinate System: Model Origin Approach

**Critical Discovery**: Instead of using Mapbox's [0,1] coordinate space directly, Mini Tokyo 3D establishes a **model origin** and calculates all positions **relative** to it.

#### Implementation

```javascript
// In map initialization (src/map.js:97)
me.modelOrigin = MercatorCoordinate.fromLngLat(options.center);
```

#### Position Calculation

```javascript
// src/map.js - getModelPosition method
getModelPosition(lnglat, altitude) {
    const me = this,
        coord = MercatorCoordinate.fromLngLat(lnglat, altitude);

    return {
        x: coord.x - me.modelOrigin.x,
        y: -(coord.y - me.modelOrigin.y),  // Note: Y is negated!
        z: coord.z - me.modelOrigin.z
    };
}
```

**Why this works**:
- Mapbox's `MercatorCoordinate.fromLngLat()` converts GPS to Mercator projection units
- Subtracting `modelOrigin` creates a **local coordinate system** centered at the map center
- **Y is negated** because Mapbox's Y-axis points south, but Three.js uses north-up convention
- All vehicles are positioned relative to this origin, which is then transformed by Mapbox's projection matrix

---

### 2. Three.js Custom Layer Integration

**File**: `src/layers/three-layer.js`

#### Layer Setup

```javascript
onAdd(map, beforeId) {
    const me = this,
        implementation = me.implementation,
        id = implementation.id,
        _mbox = map.map;

    me.map = map;
    me.modelOrigin = map.getModelOrigin();  // Store model origin

    _mbox.addLayer({
        id,
        type: 'custom',
        renderingMode: '3d',
        onAdd: (mbox, gl) => { /* Three.js setup */ },
        render: me._render.bind(me)
    }, beforeId || 'poi');
}
```

#### Render Method

```javascript
_render(gl, matrix) {
    const {modelOrigin, mbox, renderer, camera, light, scene} = this,
        {_fov, _camera, _horizonShift, pixelsPerMeter, worldSize, _pitch, width, height} = mbox.transform,

        // Create transformation matrices
        m = new Matrix4().fromArray(matrix),
        l = new Matrix4()
            .makeTranslation(modelOrigin.x, modelOrigin.y, 0)
            .scale(new Vector3(1, -1, 1));  // Flip Y-axis

    // Apply camera transformation
    camera.projectionMatrix.makePerspective(...)
        .clone().invert()
        .multiply(m)
        .multiply(l)
        .invert()
        .decompose(camera.position, camera.quaternion, camera.scale);

    renderer.resetState();
    renderer.render(scene, camera);
}
```

**Key Points**:
- Uses Mapbox's projection `matrix` directly
- Applies `modelOrigin` translation via Matrix4
- Flips Y-axis with `scale(new Vector3(1, -1, 1))`
- No manual coordinate conversion needed in render loop

---

### 3. Vehicle Positioning and Rotation

**File**: `src/layers/traffic-layer.js`

#### Adding a Vehicle (Bus Example)

```javascript
addBus(object) {
    const me = this,
        meshSet = me.busMeshSet,
        objects = me.busObjects,
        {x, y, z} = me.map.getModelPosition(object.coord, object.altitude),
        attributes = {
            translation: [x, y, z],
            rotationZ: MathUtils.degToRad(-object.bearing),  // Bearing in radians
            opacity0: 0,
            outline: object.outline,
            color: colorToRGBArray(object.color)
        };

    meshSet.addInstance(attributes);
    // ...
}
```

#### Updating a Vehicle

```javascript
updateBus(object) {
    if (!object || object.instanceIndex === undefined || object.removing) {
        return;
    }

    const me = this,
        {x, y, z} = me.map.getModelPosition(object.coord, object.altitude),
        attributes = {
            translation: [x, y, z],
            rotationZ: MathUtils.degToRad(-object.bearing),
            outline: object.outline
        };

    me.busMeshSet.setInstanceAttributes(object.instanceIndex, attributes);
}
```

**Key Points**:
1. **Position**: Use `map.getModelPosition(coord, altitude)` to get x, y, z
2. **Rotation**: Apply bearing as `rotationZ` (rotation around Z-axis, which is vertical)
3. **Bearing is negated**: `MathUtils.degToRad(-object.bearing)` - important for correct orientation
4. **No complex transforms**: The model origin approach handles all coordinate math

---

### 4. Instanced Rendering for Performance

Mini Tokyo 3D uses **instanced rendering** (GPU instancing) to render thousands of vehicles efficiently.

#### Mesh Set Pattern

**File**: `src/mesh-sets/car-mesh-set.js`

```javascript
export default class extends MeshSet {
    constructor(instanceCount, options) {
        super(
            instanceCount,
            CarGeometry,  // Single geometry shared by all instances
            options
        );
    }
}
```

**Benefits**:
- Single draw call for all trains of the same type
- GPU handles individual positions/rotations
- Scales to 1000+ vehicles at 60fps

---

### 5. Train-Specific Implementation: Positioning Along Railway Lines

**Critical Feature**: Mini Tokyo 3D doesn't position trains using raw GPS coordinates. Instead, trains are positioned **along railway line geometry** using a sophisticated GPU compute shader system.

#### Railway Geometry as Route Data

**File**: `src/gpgpu/compute-renderer.js` (lines 148-207)

Railway lines are preprocessed and uploaded to GPU textures:

```javascript
loadFeatures(features) {
    for (const feature of features) {
        const coords = feature.geometry.coordinates;  // LineString coordinates
        const distances = properties.distances;        // Distance at each point
        const sectionOffsets = properties['station-offsets'];  // Station positions

        // Convert each coordinate to Mercator units relative to model origin
        for (let i = 0; i < coords.length; i++) {
            const coord = coords[i];
            const mercatorCoord = MercatorCoordinate.fromLngLat(coord, coord[2] || 0);
            const [distance, bearing, , pitch] = distances[i];

            // Store: distance, position (x,y,z), bearing, pitch
            array1.set([
                distance,
                mercatorCoord.x - modelOrigin.x,
                -(mercatorCoord.y - modelOrigin.y),
                mercatorCoord.z - modelOrigin.z,
                MathUtils.degToRad(-bearing),
                pitch
            ], offset);
        }
    }
}
```

#### Train Position Calculation via GPU Compute Shader

**File**: `src/gpgpu/compute-fragment.glsl` (lines 96-125)

Trains use `sectionIndex` and `sectionLength` to determine position along the railway:

```glsl
void main() {
    // Read train's current section (segment between two stations)
    uint sectionIndex = object0.z;
    uint nextSectionIndex = object0.w;

    // Get distances at section start and next section
    float sectionDistance = /* lookup from texture */;
    float nextSectionDistance = /* lookup from texture */;

    // Calculate interpolated distance with acceleration/deceleration
    float elapsed = clamp(timeOffset - startTime, 0, endTime - startTime);
    float a = /* acceleration curve calculation */;
    float distance = mix(sectionDistance, nextSectionDistance, a);

    // Binary search to find which railway node the train is at
    uint index = indexOfNodeAt(distance, header.y, header.z);

    // Get current and next node data from route texture
    vec3 currentPosition = /* read from texture */;
    vec3 nextPosition = /* read from texture */;
    float rotateZ = /* bearing from texture */;

    // Interpolate between nodes for smooth movement
    a = (distance - baseDistance) / (nextDistance - baseDistance);
    vec3 position = mix(currentPosition, nextPosition, a);

    outPosition0 = vec4(position, colorID);
    outPosition1 = vec4(rotateZ, rotateX, opacityAnimationStartTime, opacity);
}
```

**How it works**:
1. **Section-based movement**: Train moves from `sectionIndex` to `nextSectionIndex` (station to station)
2. **Distance lookup**: Uses binary search to find position along railway at specific distance
3. **Smooth interpolation**: Lerps between railway nodes for fluid motion
4. **Acceleration curves**: Realistic acceleration/deceleration as trains approach stations
5. **Bearing from geometry**: Rotation comes from railway line bearing, not calculated

#### Z-Offset Elevation

**File**: `src/mesh-sets/shaders.js` (line 120)

Trains are elevated above the ground to prevent z-fighting:

```glsl
// For trains and cars
vec3 transformed = rotateZ(rotationZ) * rotateX(rotationX) * position0
                   + translation + vec3(0.0, 0.0, 0.44 * scale0);

// For buses
vec3 transformed = rotateZ(rotationZ) * position0
                   + translation + vec3(0.0, 0.0, 0.3 * scale0);
```

**Result**: Trains "float" 0.44 × scale units above the railway line, ensuring they're always visible on top.

#### Train Properties (from `src/data-classes/train.js`)

```javascript
/*
    altitude;       // Railway altitude (underground vs overground)
    sectionIndex;   // Current section (between stations)
    sectionLength;  // Total sections in journey
    coord;          // Position (calculated from railway geometry, not GPS)
    bearing;        // Direction (from railway geometry)
*/
```

#### Why This Approach?

**Advantages**:
- ✅ Trains perfectly follow railway curves
- ✅ No GPS jitter or inaccuracy issues
- ✅ Smooth acceleration/deceleration
- ✅ All calculations on GPU (extremely fast)
- ✅ Trains can't "fall off" the track

**Complexity**:
- ❌ Requires preprocessing railway geometry
- ❌ Needs GPU compute shaders
- ❌ Complex texture-based data structures

#### Trains vs. Buses

- **Trains**: GPU compute shader for movement along railway geometry
  - Positions calculated from LineString features with distance lookups
  - Section-based interpolation between stations
  - Bearing from railway geometry, not calculated
  - All on GPU for maximum performance

- **Buses**: Simpler position updates
  - Direct GPS position updates via `map.getModelPosition()`
  - No track geometry constraints
  - Bearing calculated from movement direction
  - Updated on CPU, rendered on GPU

---

### 6. Preventing Visual Overlap of Multiple Trains

**Problem**: When multiple trains are on the same line close together, they can visually overlap and appear as one blob.

**Solution**: Mini Tokyo 3D uses pseudo-random scale variation based on instance ID.

#### Pseudo-Random Scale Variation

**File**: `src/mesh-sets/shaders.js` (line 108)

```glsl
#ifdef GPGPU
// Add 0-3% size variation based on instance ID
position0 = position0 * (1.0 + float(instanceID % 256) / 256.0 * 0.03);
#else
position0 = position0 * (1.0 + idColor.b * 0.03);
#endif
```

**How it works**:
1. **Instance ID modulo 256**: `instanceID % 256` gives values 0-255
2. **Normalize to 0-1**: `/ 256.0` converts to range 0.0-1.0
3. **3% variation**: `* 0.03` gives 0-3% scale difference
4. **Add to base scale**: `1.0 +` means scales from 100% to 103%

**Result**:
- Train #0: 100.0% scale
- Train #1: 100.004% scale (slightly bigger)
- Train #255: 103.0% scale
- Train #256: 100.0% scale (wraps around)

This creates subtle size differences that prevent z-fighting and visual merging when trains overlap.

#### Sorted Rendering for Smooth Animations

**File**: `src/gpgpu/compute-renderer.js` (lines 142-143)

```javascript
// Sort by pseudo-random value for smooth fade animations
ugCarIDs.body.sort((a, b) => a % 256 - b % 256);
ogCarIDs.body.sort((a, b) => a % 256 - b % 256);
```

Trains are rendered in sorted order by their `instanceID % 256` value, which:
- Ensures consistent draw order
- Makes fade animations smooth and predictable
- Prevents flickering when trains overlap

#### Altitude Separation

**File**: `src/data-classes/railway.js` (lines 45-51)

```javascript
if (altitude) {
    /**
     * Railway altitude.
     * @type {number}
     */
    me.altitude = altitude;
}
```

Different railways can have different altitudes (underground vs. overground), providing physical z-separation.

#### Implementation for Our Project

**Simple Approach** (without compute shaders):

```typescript
// 1. Add Z-offset elevation when positioning trains
const { x, y, z } = getModelPosition(train.longitude, train.latitude, 0);
const scale = calculateScale(zoom);
const zOffset = 0.44 * scale;  // Elevate train above ground
trainMesh.position.set(x, y, z + zOffset);

// 2. Add pseudo-random scale variation to prevent overlap
const trainIndex = parseInt(train.vehicleKey.replace(/\D/g, '')) || 0;
const scaleVariation = 1.0 + (trainIndex % 256) / 256.0 * 0.03;  // 0-3% variation
trainMesh.scale.setScalar(scale * scaleVariation);

// 3. (Optional) Snap to railway line if available
// If you have railway LineString geometry:
const pointOnLine = nearestPointOnLine(routeGeometry, train.latitude, train.longitude);
const linePosition = getModelPosition(pointOnLine.lng, pointOnLine.lat, 0);
trainMesh.position.set(linePosition.x, linePosition.y, z + zOffset);
```

**Advanced Approach** (snap to railway geometry):

```typescript
// Preprocess railway LineString to get bearing at each point
interface RailwayNode {
    position: [number, number];  // [lng, lat]
    distance: number;  // Cumulative distance from start
    bearing: number;   // Direction at this point
}

function preprocessRailwayLine(lineCoords: number[][]): RailwayNode[] {
    const nodes: RailwayNode[] = [];
    let distance = 0;

    for (let i = 0; i < lineCoords.length; i++) {
        if (i > 0) {
            distance += haversineDistance(lineCoords[i-1], lineCoords[i]);
        }

        const bearing = i < lineCoords.length - 1
            ? calculateBearing(...lineCoords[i], ...lineCoords[i+1])
            : nodes[i-1].bearing;  // Use previous bearing for last point

        nodes.push({
            position: [lineCoords[i][0], lineCoords[i][1]],
            distance,
            bearing
        });
    }

    return nodes;
}

// Snap train to nearest point on railway and get bearing from geometry
function snapTrainToRailway(
    train: TrainPosition,
    railwayNodes: RailwayNode[]
): { position: [number, number], bearing: number } {
    // Find nearest node (simple approach, could use binary search)
    let nearestNode = railwayNodes[0];
    let minDist = Infinity;

    for (const node of railwayNodes) {
        const dist = haversineDistance(
            [train.longitude, train.latitude],
            node.position
        );
        if (dist < minDist) {
            minDist = dist;
            nearestNode = node;
        }
    }

    return {
        position: nearestNode.position,
        bearing: nearestNode.bearing
    };
}

// Usage
const railwayNodes = preprocessRailwayLine(lineGeometry.coordinates);
const { position, bearing } = snapTrainToRailway(train, railwayNodes);
const { x, y, z } = getModelPosition(position[0], position[1], 0);
const zOffset = 0.44 * scale;
trainMesh.position.set(x, y, z + zOffset);
trainMesh.rotation.z = -bearing * (Math.PI / 180);  // Negate bearing
```

**Key Takeaways**:
1. **Z-offset elevation**: Always elevate trains above ground by `0.44 * scale`
2. **Scale variation**: Add 0-3% size variation based on train ID to prevent overlap
3. **Snap to line** (advanced): Use railway geometry for perfect positioning
4. **Bearing from geometry** (advanced): Get rotation from railway line direction, not calculated

---

## Critical Differences from Our Implementation

### ❌ What We Did Wrong

1. **Coordinate System**: We tried using Mapbox's [0,1] space directly
   ```javascript
   // WRONG - our approach
   const x = (lng + 180) / 360;
   const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2;
   ```

2. **No Model Origin**: We didn't establish a reference point
   - This causes floating point precision issues
   - Makes transforms more complex

3. **Wrong Scale**: We calculated scale manually
   ```javascript
   // WRONG
   private readonly TRAIN_SCALE = 0.00000008;
   ```

### ✅ What We Should Do

1. **Use Mapbox's MercatorCoordinate**:
   ```javascript
   import {MercatorCoordinate} from 'mapbox-gl';

   const coord = MercatorCoordinate.fromLngLat([lng, lat], altitude);
   const position = {
       x: coord.x - modelOrigin.x,
       y: -(coord.y - modelOrigin.y),
       z: coord.z - modelOrigin.z
   };
   ```

2. **Establish Model Origin**:
   ```javascript
   const modelOrigin = MercatorCoordinate.fromLngLat(map.getCenter());
   ```

3. **Use Model Scale from Mapbox**:
   ```javascript
   const modelScale = modelOrigin.meterInMercatorCoordinateUnits();
   // Then scale models: modelScale * desiredSizeInMeters
   ```

4. **Rotation**:
   ```javascript
   // Apply bearing as Z-rotation (negated)
   mesh.rotation.z = MathUtils.degToRad(-bearing);
   ```

---

## Recommended Implementation for Our Project

### Step 1: Add Model Origin to MapCanvas

```javascript
// In MapCanvas.tsx, after map initialization
const modelOrigin = mapboxgl.MercatorCoordinate.fromLngLat(map.getCenter());
```

### Step 2: Create getModelPosition Helper

```javascript
// In a new file: src/lib/map/coordinates.ts
import mapboxgl from 'mapbox-gl';

let modelOrigin: mapboxgl.MercatorCoordinate;

export function setModelOrigin(center: [number, number]) {
    modelOrigin = mapboxgl.MercatorCoordinate.fromLngLat(center);
}

export function getModelPosition(
    lng: number,
    lat: number,
    altitude: number = 0
): { x: number; y: number; z: number } {
    const coord = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], altitude);

    return {
        x: coord.x - modelOrigin.x,
        y: -(coord.y - modelOrigin.y),  // Negate Y!
        z: coord.z - modelOrigin.z
    };
}

export function getModelScale(): number {
    return modelOrigin.meterInMercatorCoordinateUnits();
}
```

### Step 3: Update TrainMeshManager

```javascript
// In trainMeshManager.ts
import { getModelPosition, getModelScale } from '../../lib/map/coordinates';

// Remove lngLatToMapboxPosition - use getModelPosition instead

// In createTrainMesh:
const { x, y, z } = getModelPosition(train.longitude, train.latitude, 0);
trainModel.position.set(x, y, z);

// Scale using model scale:
const modelScale = getModelScale();
const trainSizeMeters = 25; // 25 meter train
trainModel.scale.setScalar(trainSizeMeters * modelScale);

// Rotation (negate the bearing):
trainModel.rotation.z = -bearing * (Math.PI / 180);
```

### Step 4: Fix Model Orientation

```javascript
// Models likely need to lay flat
// Try different rotations:
trainModel.rotation.x = -Math.PI / 2;  // OR
trainModel.rotation.y = Math.PI / 2;   // Test which works
```

---

## Advanced Features

### 6. Zoom-Based Dynamic Scaling

**Critical Feature**: Mini Tokyo 3D dynamically adjusts model sizes based on zoom level and camera position, making vehicles appear larger when zoomed in and smaller when zoomed out.

#### Uniform System

**File**: `src/mesh-sets/mesh-set.js`

Each mesh set maintains three key uniforms that are passed to shaders:

```javascript
constructor(parameters) {
    this.uniforms = {
        zoom: {value: parameters.zoom},           // Current map zoom level
        cameraZ: {value: parameters.cameraZ},     // Camera Z position for perspective
        modelScale: {value: parameters.modelScale} // Base scale in Mercator units
    };
}
```

#### Shader Scale Calculation

**File**: `src/mesh-sets/shaders.js`

The GLSL shader uses these uniforms to calculate dynamic scale:

```glsl
uniform float zoom;
uniform float cameraZ;
uniform float modelScale;

// Scale calculation function - exponential zoom relationship
float getScale(float zoom, float modelScale) {
    return pow(2.0, 14.0 - clamp(zoom, 13.0, 19.0)) * modelScale * 100.0;
}

// In vertex shader - apply perspective-adjusted zoom
float zoom0 = zoom + log2(cameraZ / abs(cameraZ - translation.z));
float scale0 = getScale(zoom0, modelScale);
vec3 position0 = position * scale0;
```

**How it works**:
1. **Exponential relationship**: `pow(2.0, 14.0 - zoom)` creates exponential scaling
   - At zoom 14: scale = 1.0 × modelScale × 100
   - At zoom 15: scale = 0.5 × modelScale × 100
   - At zoom 13: scale = 2.0 × modelScale × 100
2. **Zoom clamping**: Clamps between zoom 13-19 to prevent extreme sizes
3. **Perspective adjustment**: Adds camera depth to zoom for depth-aware scaling
4. **Z-offset**: Elevates models slightly above ground: `+ vec3(0.0, 0.0, 0.44 * scale0)`

#### Dynamic Updates on Zoom/Pitch Change

**File**: `src/layers/traffic-layer.js`

```javascript
onAdd(map, context) {
    // ... initialization

    // Listen to camera changes
    map.on('zoom', me.onCameraChanged);
    map.on('pitch', me.onCameraChanged);
}

onCameraChanged() {
    const me = this,
        map = me.map,
        cameraParams = {
            zoom: map.getZoom(),
            cameraZ: map.map.getFreeCameraOptions().position.z
        };

    // Update all mesh sets with new camera parameters
    me.ugCarMeshSet.refreshCameraParams(cameraParams);
    me.ogCarMeshSet.refreshCameraParams(cameraParams);
    me.aircraftMeshSet.refreshCameraParams(cameraParams);
    me.busMeshSet.refreshCameraParams(cameraParams);
}
```

**File**: `src/mesh-sets/mesh-set.js`

```javascript
refreshCameraParams(params) {
    const uniforms = this.uniforms;

    // Update shader uniforms - causes GPU to re-scale all instances
    uniforms.zoom.value = params.zoom;
    uniforms.cameraZ.value = params.cameraZ;
}
```

**Key Points**:
- **GPU-side calculation**: Scaling happens in vertex shader - very efficient
- **All instances updated**: Single uniform change rescales thousands of models
- **Smooth transitions**: No jumps or pops when zooming
- **Perspective-aware**: Models closer to camera appear relatively larger

#### Implementation for Our Project

```typescript
// 1. Add uniforms to shader material
const uniforms = {
    zoom: { value: map.getZoom() },
    cameraZ: { value: map.getFreeCameraOptions().position.z },
    modelScale: { value: modelOrigin.meterInMercatorCoordinateUnits() }
};

// 2. Listen to map events
map.on('zoom', updateCameraParams);
map.on('pitch', updateCameraParams);

function updateCameraParams() {
    uniforms.zoom.value = map.getZoom();
    uniforms.cameraZ.value = map.getFreeCameraOptions().position.z;
}

// 3. Use in vertex shader (or apply directly to mesh scale)
// Simple approach without custom shaders:
function updateTrainScale(zoom: number, baseScale: number) {
    const scale = Math.pow(2, 14 - Math.max(13, Math.min(19, zoom))) * baseScale;
    trainMesh.scale.setScalar(scale);
}
```

#### Camera-Aware Scaling Notes (Reference)

- `mini-tokyo-3d-master/src/mesh-sets/shaders.js:9` keeps trains at a consistent physical size by evaluating `pow(2, 14 - clamp(zoom, 13, 19)) * modelScale * 100`. The `modelScale` term is the meters-to-Mercator factor passed in from Mapbox.
- `mini-tokyo-3d-master/src/mesh-sets/shaders.js:93` refines that zoom with `log2(cameraZ / abs(cameraZ - translation.z))`, so pitching the map or changing altitude does not make trains “float” or sink visually.
- `mini-tokyo-3d-master/src/mesh-sets/shaders.js:120` lifts every vehicle by `0.44 * scale0`, matching the body height of the GLB. The offset is applied after rotation so the chassis always sits just above the tile surface.

#### Multi-Zoom Railway Snapping

- `mini-tokyo-3d-master/src/loader/features.js:301` precomputes “station offsets” and densified LineStrings for each railway at zoom levels 13–18. Both overground and underground segments are stored separately so altitude and opacity remain correct.
- `mini-tokyo-3d-master/src/gpgpu/compute-renderer.js:150` packs those multi-zoom polylines into GPU textures. For every vertex the loader stores Mercator X/Y/Z, bearing, and pitch relative to the map’s `modelOrigin`.
- `mini-tokyo-3d-master/src/gpgpu/compute-fragment.glsl:53` performs a binary search (`indexOfNodeAt`) against the packed distances per zoom level, then interpolates between the nearest two samples. That guarantees the train is snapped to the surveyed rail geometry for the active zoom, without CPU work.
- `mini-tokyo-3d-master/src/gpgpu/compute-fragment.glsl:120` uses the stored bearings and pitch to rotate the mesh so headlights/doors line up with the right-of-way even when the track climbs or dives underground.

#### Overlap Mitigation in Dense Corridors

- `mini-tokyo-3d-master/src/mesh-sets/shaders.js:108` scales each instance by `1 + (instanceID % 256) * 0.03 / 256`, creating a subtle size jitter so stacked trains do not z-fight or look identical.
- `mini-tokyo-3d-master/src/gpgpu/compute-renderer.js:142` reorders instance IDs by `(id % 256)` before pushing them to the instanced geometry. The stable ordering stops the GPU fade-in/fade-out from swapping overlapping trains every frame.
- `mini-tokyo-3d-master/src/loader/features.js:324` splits every route section into separate ground and underground feature buckets. Combined with altitude metadata, that lets the renderer raise later arrivals into the correct “lane” when two services share a portal.

#### When We Implement This

1. Extend our data loader to emit multi-zoom railway geometries with station offsets (mirror `loader/features.js` pipeline).
2. Build a lightweight GPU/CPU buffer that exposes interpolated Mercator coordinates, bearing, and pitch per zoom (reuse `compute-renderer.js` logic or a simplified CPU cache).
3. Wire a Mapbox zoom/pitch listener that feeds `zoom`, `cameraZ`, and `modelScale` uniforms into a shader-based train renderer (or equivalent CPU transform).
4. Replace the current per-train scale/offset math with the shader-driven formula so models stay glued to the track regardless of zoom depth.
5. Preserve overlap mitigation by applying deterministic scale jitter and stable instance ordering when assigning mesh IDs.

---

### 7. See-Through Buildings for Better Visibility

**Critical Feature**: Mini Tokyo 3D makes buildings semi-transparent so trains/vehicles are always visible, even when passing behind buildings.

#### Opacity Metadata System

**File**: `assets/style.json`

Buildings have custom metadata controlling opacity in different view modes:

```json
{
    "id": "building-models",
    "type": "model",
    "source": "3dbuildings",
    "minzoom": 13.7,
    "metadata": {
        "mt3d:opacity-effect": true,
        "mt3d:opacity": 1,                      // Default: 100% opaque
        "mt3d:opacity-route": 0.1,              // Route view: 10% opaque
        "mt3d:opacity-underground": 0.0625,      // Underground: 6.25% (very transparent)
        "mt3d:opacity-underground-route": 0.025  // Underground+route: 2.5%
    },
    "paint": {
        "model-ambient-occlusion-intensity": 0.75,
        "model-opacity": 1  // This gets dynamically adjusted
    }
}
```

#### Dynamic Opacity Adjustment

**File**: `src/helpers/helpers-mapbox.js`

```javascript
/**
 * Returns an array of style opacity information from map layers
 */
export function getStyleOpacities(map, metadataKey) {
    const {_layers, _order} = map.style;
    const opacities = [];

    // Find all layers with opacity metadata
    _order.map(id => _layers[id])
        .filter(({metadata}) => metadata && metadata[metadataKey])
        .forEach(({id, type, metadata}) => {
            const key = `${type}-opacity`;
            const prop = map.getPaintProperty(id, key);
            opacities.push({id, key, opacity: prop, metadata});
        });

    return opacities;
}

/**
 * Sets style opacities based on mode
 */
export function setStyleOpacities(map, styleOpacities, factorKey) {
    for (const {id, key, opacity, metadata} of styleOpacities) {
        const factor = metadata[factorKey];  // e.g., 'mt3d:opacity-underground'

        if (Array.isArray(opacity)) {
            // Handle interpolated opacity expressions
            const prop = map.getPaintProperty(id, key);
            for (const {index, value} of opacity) {
                const scaledOpacity = value * factor;
                prop[index] = scaledOpacity;
            }
        } else {
            // Simple opacity value
            prop = opacity * factor;
        }

        map.setPaintProperty(id, key, prop);
    }
}
```

#### Usage Pattern

**File**: `src/map.js`

```javascript
// Initialize opacity system
const buildingOpacities = getStyleOpacities(map, 'mt3d:opacity-effect');

// Change view mode - buildings become transparent
function switchToUndergroundView() {
    // Apply 'mt3d:opacity-underground' factor to all buildings
    setStyleOpacities(map, buildingOpacities, 'mt3d:opacity-underground');
    // Buildings now at 6.25% opacity - trains visible through them
}

function switchToOvergroundView() {
    // Apply 'mt3d:opacity' factor (default 1.0)
    setStyleOpacities(map, buildingOpacities, 'mt3d:opacity');
    // Buildings back to 100% opacity
}

function switchToRouteView(routeId) {
    // Apply 'mt3d:opacity-route' factor
    setStyleOpacities(map, buildingOpacities, 'mt3d:opacity-route');
    // Buildings at 10% opacity - route clearly visible
}
```

#### Additional Performance Optimization

**File**: `src/map.js`

```javascript
// Hide building models entirely when clock speed is high
map.setLayoutProperty('building-models', 'visibility',
    clock.speed <= 30 ? 'visible' : 'none'
);
```

This hides 3D building models during fast playback to maintain 60fps.

#### Implementation for Our Project

**Approach 1: Simple Mapbox Paint Property**

```typescript
// In MapCanvas.tsx initialization
map.on('load', () => {
    // Reduce building opacity for better train visibility
    const layers = map.getStyle().layers;

    layers?.forEach((layer) => {
        if (layer.type === 'fill-extrusion' && layer.id.includes('building')) {
            map.setPaintProperty(layer.id, 'fill-extrusion-opacity', 0.5);
        }
    });
});
```

**Approach 2: Mode-Based Opacity (Similar to Mini Tokyo 3D)**

```typescript
// Create opacity control system
interface OpacityConfig {
    layerId: string;
    defaultOpacity: number;
    focusOpacity: number;  // When viewing specific train/route
}

const buildingLayers: OpacityConfig[] = [
    { layerId: '3d-buildings', defaultOpacity: 0.6, focusOpacity: 0.2 }
];

function setBuildingOpacity(mode: 'default' | 'focus') {
    buildingLayers.forEach(({layerId, defaultOpacity, focusOpacity}) => {
        const opacity = mode === 'focus' ? focusOpacity : defaultOpacity;
        map.setPaintProperty(layerId, 'fill-extrusion-opacity', opacity);
    });
}

// Usage:
// Normal view - buildings 60% opaque
setBuildingOpacity('default');

// Focusing on specific train - buildings 20% opaque
setBuildingOpacity('focus');
```

**Approach 3: Custom Building Layer with Higher Transparency**

```typescript
// In MapCanvas.tsx where we add 3d-buildings layer
map.addLayer({
    id: '3d-buildings',
    source: 'composite',
    'source-layer': 'building',
    filter: ['==', 'extrude', 'true'],
    type: 'fill-extrusion',
    minzoom: 14,
    paint: {
        'fill-extrusion-color': [
            'interpolate',
            ['linear'],
            ['get', 'height'],
            0, 'rgba(200, 200, 200, 0.5)',  // 50% opacity instead of 80%
            50, 'rgba(180, 180, 180, 0.5)',
            100, 'rgba(160, 160, 160, 0.5)',
        ],
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-base': ['get', 'min_height'],
        'fill-extrusion-opacity': 0.4,  // Global 40% opacity
    },
}, firstSymbolId);
```

---

## Performance Considerations

Mini Tokyo 3D achieves 60fps with 1000+ vehicles using:

1. **GPU Instancing**: Single geometry, multiple instances
2. **Compute Shaders**: Position calculations on GPU
3. **LOD**: Different detail levels based on zoom
4. **Culling**: Only render visible vehicles
5. **Texture Atlases**: Combine textures to reduce draw calls
6. **Zoom-based Scaling**: GPU shader scaling instead of CPU updates
7. **Dynamic Building Opacity**: Buildings fade when needed, hidden during fast playback

---

## References

- **Mini Tokyo 3D Source**: https://github.com/nagix/mini-tokyo-3d
- **Mapbox Custom Layer**: https://docs.mapbox.com/mapbox-gl-js/api/properties/#customlayerinterface
- **MercatorCoordinate**: https://docs.mapbox.com/mapbox-gl-js/api/geography/#mercatorcoordinate
- **Three.js Instancing**: https://threejs.org/docs/#api/en/objects/InstancedMesh

---

## Summary

The critical insights from Mini Tokyo 3D are:

### Core Architecture

> **Don't try to work in Mapbox's abstract coordinate space. Use `MercatorCoordinate` to convert GPS to Mercator units, then work relative to a model origin. Let Mapbox's projection matrix handle the rest.**

This approach:
- ✅ Simplifies coordinate math
- ✅ Improves numerical precision
- ✅ Makes scaling intuitive (use meters)
- ✅ Follows Mapbox's intended pattern
- ✅ Matches how 3D engines naturally work

### Advanced Features

> **Use GPU-side scaling with zoom uniforms and semi-transparent buildings to create a smooth, professional 3D map experience.**

Key techniques:
- ✅ **Zoom-based scaling**: Exponential relationship (`pow(2, 14 - zoom)`) with perspective adjustment
- ✅ **GPU uniforms**: Pass zoom/cameraZ to shaders for efficient rescaling
- ✅ **Building transparency**: Reduce building opacity (40-60%) for better train visibility
- ✅ **Mode-based opacity**: Different opacity levels for normal, route, and underground views
- ✅ **Performance**: Hide buildings during fast playback, use GPU instancing

### Implementation Priority

For our Rodalies 3D project, implement in this order:

1. **Phase 1 - Core Positioning** (Highest Priority)
   - Model origin coordinate system
   - MercatorCoordinate API
   - Correct bearing rotation (negated)

2. **Phase 2 - Visual Polish**
   - Zoom-based dynamic scaling
   - Building opacity reduction (40-50%)

3. **Phase 3 - Advanced Features** (Future)
   - Mode-based building opacity
   - GPU shader optimizations
   - Instanced rendering for multiple trains
