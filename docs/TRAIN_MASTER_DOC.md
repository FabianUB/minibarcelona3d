# Train System Master Documentation

> Comprehensive technical documentation for the real-time train visualization system in mini-rodalies-3d.

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Data Types & Structures](#3-data-types--structures)
4. [API Client & Data Fetching](#4-api-client--data-fetching)
5. [Data Loading & Caching](#5-data-loading--caching)
6. [TrainLayer3D Component](#6-trainlayer3d-component)
7. [TrainMeshManager](#7-trainmeshmanager)
8. [Animation System](#8-animation-system)
9. [Railway Geometry & Snapping](#9-railway-geometry--snapping)
10. [Model Management](#10-model-management)
11. [Train Configuration](#11-train-configuration)
12. [Zoom-Responsive Scaling](#12-zoom-responsive-scaling)
13. [Hover Outlines](#13-hover-outlines)
14. [Station Parking](#14-station-parking)
15. [Predictive Positioning](#15-predictive-positioning)
16. [Train State Management](#16-train-state-management)
17. [Backend API](#17-backend-api)
18. [Database Schema](#18-database-schema)
19. [Performance Characteristics](#19-performance-characteristics)
20. [Configuration Constants](#20-configuration-constants)
21. [Error Handling](#21-error-handling)
22. [Debugging & Monitoring](#22-debugging--monitoring)
23. [Known Issues & Limitations](#23-known-issues--limitations)
24. [Animation Regression Analysis (post-004-station-visualization)](#24-animation-regression-analysis-post-004-station-visualization)

---

## 1. System Overview

The train visualization system displays real-time positions of Rodalies de Catalunya commuter trains on a 3D map. It integrates:

- **Mapbox GL JS** for base map rendering
- **Three.js** for 3D train models via Custom Layer API
- **React** for component lifecycle and state management
- **Go backend** for API endpoints
- **PostgreSQL** for real-time train data storage

### Key Features

- Real-time train positions updated every 30 seconds
- Smooth interpolation between position updates
- Railway line snapping for accurate track following
- 3D train models with correct orientation (bearing)
- Hover/click interaction with line identification
- Zoom-responsive scaling
- Line filtering (highlight/isolate modes)
- Station parking visualization for stopped trains

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA FLOW                                       │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  PostgreSQL  │───▶│   Go API     │───▶│  React App   │───▶│   Mapbox +   │
│  Database    │    │  /api/trains │    │  TrainLayer  │    │   Three.js   │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
       │                   │                   │                    │
       │                   │                   │                    │
       ▼                   ▼                   ▼                    ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ rt_rodalies_ │    │ JSON Response│    │ TrainMesh    │    │ WebGL Render │
│ vehicle_     │    │ positions[]  │    │ Manager      │    │ 60 FPS       │
│ current      │    │ previousPos[]│    │ animatePos() │    │              │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                           COMPONENT HIERARCHY                                │
└─────────────────────────────────────────────────────────────────────────────┘

App
 └─ MapStateProvider
     └─ MapCanvas
         ├─ TrainLayer3D ─────────────────────────┐
         │   ├─ Three.js Scene                    │
         │   │   ├─ Train Meshes (100+)           │
         │   │   ├─ Lighting (ambient + dir)      │
         │   │   └─ Environment Map               │
         │   ├─ TrainMeshManager                  │
         │   │   ├─ Mesh lifecycle                │
         │   │   ├─ Animation loop                │
         │   │   └─ Railway snapping              │
         │   └─ Interaction handlers              │
         │       ├─ Hover detection               │
         │       └─ Click detection               │
         ├─ TrainListButton ──────────────────────┤
         │   └─ TrainListPanel                    │
         ├─ TrainInfoPanel (Desktop/Mobile)       │
         └─ StationLayer                          │
                                                  │
         ◄─── onTrainsChange callback ────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                            POLLING CYCLE                                     │
└─────────────────────────────────────────────────────────────────────────────┘

    T=0s              T=15s              T=30s              T=45s
     │                  │                  │                  │
     ▼                  ▼                  ▼                  ▼
  ┌─────┐           ┌─────┐           ┌─────┐           ┌─────┐
  │POLL │           │ ... │           │POLL │           │ ... │
  │ A   │           │     │           │ B   │           │     │
  └──┬──┘           │     │           └──┬──┘           │     │
     │              │     │              │              │     │
     └──────────────┴─────┴──────────────┘              │     │
              INTERPOLATION A → B                       │     │
              (30 seconds, easeInOutCubic)              │     │
                                                        │     │
                                        └───────────────┴─────┘
                                         INTERPOLATION B → C
```

---

## 3. Data Types & Structures

### Frontend Types (`src/types/trains.ts`)

#### Train (Complete Entity)

```typescript
interface Train {
  // Identity
  vehicleKey: string;      // Primary key (e.g., "25633")
  vehicleId: string;       // GTFS vehicle ID
  vehicleLabel: string;    // Display label (e.g., "R1 25633")
  entityId: string;        // Entity identifier

  // Position (nullable - some trains don't report GPS)
  latitude: number | null;
  longitude: number | null;

  // Trip Context
  tripId: string;
  routeId: string;         // e.g., "51T0001R1"

  // Stop Context
  currentStopId: string | null;
  previousStopId: string | null;
  nextStopId: string | null;
  nextStopSequence: number | null;

  // Status
  status: VehicleStatus;   // 'IN_TRANSIT_TO' | 'STOPPED_AT' | 'INCOMING_AT'

  // Delays (seconds, can be negative for early)
  arrivalDelaySeconds: number | null;
  departureDelaySeconds: number | null;

  // Schedule
  scheduleRelationship: string | null;
  predictedArrivalUtc: string | null;
  predictedDepartureUtc: string | null;

  // Timestamps
  vehicleTimestampUtc: string | null;
  polledAtUtc: string;
  updatedAt: string;
}
```

#### TrainPosition (Lightweight for Polling)

```typescript
interface TrainPosition {
  vehicleKey: string;
  latitude: number | null;
  longitude: number | null;
  nextStopId: string | null;
  routeId: string;
  status: string | null;
  polledAtUtc: string;
}
```

**Size:** ~1KB per train (optimized for frequent polling)

#### API Responses

```typescript
interface GetAllTrainPositionsResponse {
  positions: TrainPosition[];
  previousPositions?: TrainPosition[];  // For interpolation
  count: number;
  polledAt: string;
  previousPolledAt?: string;
}

interface GetAllTrainsResponse {
  trains: Train[];
  count: number;
  polledAt: string;
}
```

### Internal Mesh Data (`TrainMeshData`)

```typescript
interface TrainMeshData {
  mesh: THREE.Group;                    // Container for train model
  vehicleKey: string;                   // Unique identifier
  routeId: string;                      // Line identifier

  // Animation state
  currentPosition: [number, number];    // [lng, lat] - interpolation start
  targetPosition: [number, number];     // [lng, lat] - interpolation end
  lastUpdate: number;                   // Timestamp (ms) when position updated
  interpolationDuration: number;        // Duration for smooth animation

  // Railway snapping
  currentSnap?: RailwaySnapState;       // Snapped position on track
  targetSnap?: RailwaySnapState;        // Target snap state

  // Spatial positioning
  lateralOffsetIndex: number;           // Slot for co-located trains
  baseScale: number;                    // Base scale multiplier
  boundingCenterOffset: THREE.Vector3;
  boundingRadius: number;

  // Validation
  hasUnrealisticSpeed: boolean;         // Speed validation flag
  warningIndicator?: THREE.Sprite;      // Visual warning

  // Status
  status: string;                       // STOPPED_AT, IN_TRANSIT_TO, INCOMING_AT

  // Zoom-responsive scaling
  screenSpaceScale: number;             // Current zoom multiplier
  lastZoomBucket: number;               // Quantized zoom for caching

  // Hover system
  outlineMesh?: THREE.Group;            // Lazy-loaded outline
  lineCode?: string;                    // Extracted from routeId
  lineColor?: THREE.Color;              // Line brand color

  // Parking
  isParkingRotationApplied?: boolean;   // 90° rotation state
  parkingPosition?: ParkingPosition;    // Calculated parking slot
  stoppedAtStationId?: string;          // Station ID if stopped

  // Predictive positioning
  tripId?: string;
  nextStopId?: string;
  lastPredictiveSource?: 'gps' | 'predicted' | 'blended';
  predictiveConfidence?: number;
}
```

---

## 4. API Client & Data Fetching

**File:** `src/lib/api/trains.ts`

### Core Functions

#### fetchTrainPositions()

Most frequently called function (~every 30 seconds).

```typescript
async function fetchTrainPositions(): Promise<GetAllTrainPositionsResponse>
```

- Returns lightweight position data only
- Performance target: <50ms for ~100 trains
- Includes `previousPositions` for interpolation calculation

#### fetchAllTrains(routeId?)

```typescript
async function fetchAllTrains(routeId?: string): Promise<GetAllTrainsResponse>
```

- Returns all active trains updated within 10 minutes
- Optional route filtering
- Performance target: <100ms for ~100 trains

#### fetchTrainByKey(vehicleKey)

```typescript
async function fetchTrainByKey(vehicleKey: string): Promise<Train>
```

- Primary key lookup for train details panel
- Performance target: <10ms
- Called when user clicks a train

#### fetchTripDetails(tripId)

```typescript
async function fetchTripDetails(tripId: string): Promise<TripDetails>
```

- Returns complete trip schedule with all stops
- Used for predictive positioning

### Retry Strategy

```typescript
const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelay: 1000,    // 1 second
  maxDelay: 5000,     // 5 seconds max
};
```

- Exponential backoff with jitter
- Jitter formula: `exponentialDelay + (random * 0.5 * exponentialDelay)`
- Only retries on 5xx errors and network failures
- Does NOT retry on 4xx errors (client errors)

---

## 5. Data Loading & Caching

### Trip Cache (`src/lib/trains/tripCache.ts`)

```typescript
class TripCache {
  private cache: Map<string, CacheEntry>;
  private pendingRequests: Map<string, Promise<TripDetails>>;

  constructor(options: {
    ttlMs?: number;      // Default: 600000 (10 minutes)
    maxSize?: number;    // Default: 200 entries
  });

  get(tripId: string): TripDetails | undefined;
  getOrFetch(tripId: string): Promise<TripDetails>;
  prefetch(tripId: string): void;
  prefetchMany(tripIds: string[]): void;
  invalidate(tripId: string): void;
  getStats(): CacheStats;
}
```

**Features:**
- TTL-based expiration (10 minutes default)
- Deduplicates concurrent requests for same tripId
- LRU-style eviction at max capacity
- Performance statistics tracking

**Global Instance:**
```typescript
const tripCache = getTripCache();
```

---

## 6. TrainLayer3D Component

**File:** `src/features/trains/TrainLayer3D.tsx`

### Purpose

Main rendering component that integrates Three.js with Mapbox GL JS using the Custom Layer API.

### Props

```typescript
interface TrainLayer3DProps {
  map: MapboxMap;                           // Mapbox GL Map instance
  beforeId?: string;                        // Layer z-index control
  onRaycastResult?: (result) => void;       // Debug callback
  onLoadingChange?: (isLoading) => void;    // Loading state callback
  onTrainsChange?: (trains) => void;        // Train list callback
}
```

### State Variables

| State | Type | Description |
|-------|------|-------------|
| `trains` | `TrainPosition[]` | Current train positions |
| `error` | `string \| null` | API or loading errors |
| `isLoading` | `boolean` | Data fetch state |
| `modelsLoaded` | `boolean` | 3D models ready |
| `stationsLoaded` | `boolean` | Station data ready |
| `railwaysLoaded` | `boolean` | Railway geometry ready |
| `sceneReady` | `boolean` | Three.js scene initialized |
| `isDataStale` | `boolean` | Data older than 60 seconds |
| `retryCount` | `number` | Exponential backoff tracking |
| `lastPollTime` | `number` | For countdown display |

### Mapbox Custom Layer Interface

```typescript
const customLayer: mapboxgl.CustomLayerInterface = {
  id: 'train-layer-3d',
  type: 'custom',
  renderingMode: '3d',

  onAdd(map, gl) {
    // Initialize Three.js scene
    // - Create Scene, Camera, Renderer
    // - Set up lighting (ambient + directional)
    // - Load environment map (RoomEnvironment)
    // - Preload all train models
  },

  render(gl, matrix) {
    // Called every frame (~60fps)
    // - Update camera projection matrix
    // - Call meshManager.animatePositions()
    // - Call meshManager.applyParkingVisuals()
    // - Render Three.js scene
    // - Performance monitoring
    // - Request next frame via map.triggerRepaint()
  },

  onRemove() {
    // Cleanup resources
  }
};
```

### Three.js Scene Setup

```typescript
// Lighting Configuration
const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
keyLight.position.set(160, 200, 260);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
fillLight.position.set(-120, -80, 180);

// Renderer Settings
renderer.autoClear = false;           // Don't clear Mapbox's render
renderer.shadowMap.enabled = false;   // Disabled for performance
renderer.sortObjects = false;         // Skip sorting for performance
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.LinearToneMapping;
```

### Polling System

```typescript
const POLLING_INTERVAL_MS = 30000;  // 30 seconds

useEffect(() => {
  // Initial fetch
  void fetchTrains();

  // Set up polling interval
  pollingIntervalRef.current = setInterval(() => {
    void fetchTrains();
  }, POLLING_INTERVAL_MS);

  return () => clearInterval(pollingIntervalRef.current);
}, [fetchTrains]);
```

### Stale Data Detection

```typescript
const STALE_DATA_THRESHOLD_MS = 60000;  // 60 seconds

// Checked every 5 seconds
const dataAge = Date.now() - polledAtTimestamp;
const isStale = dataAge > STALE_DATA_THRESHOLD_MS;

// Visual indicator: reduce opacity by 50%
const finalOpacity = isDataStale ? baseOpacity * 0.5 : baseOpacity;
```

### Line Filtering (Highlight/Isolate)

```typescript
function getTrainOpacity(train: TrainPosition): number {
  if (highlightMode === 'none' || highlightedLineIds.length === 0) {
    return 1.0;  // Full opacity
  }

  const lineCode = extractLineFromRouteId(train.routeId);
  const isHighlighted = isLineHighlighted(lineCode);

  if (isHighlighted) {
    return 1.0;                              // Selected lines: full
  } else if (highlightMode === 'highlight') {
    return 0.25;                             // Others: 25% opacity
  } else {
    return 0.0;                              // Isolate: invisible
  }
}
```

---

## 7. TrainMeshManager

**File:** `src/lib/trains/trainMeshManager.ts`

### Purpose

Manages the lifecycle of 3D train mesh instances, including creation, animation, positioning, and removal.

### Constructor

```typescript
constructor(
  scene: THREE.Scene,
  stations: Station[],
  railwayLines: Map<string, PreprocessedRailwayLine>
)
```

### Key Methods

#### updateTrainMeshes()

Main update loop called when train data changes.

```typescript
updateTrainMeshes(
  trains: TrainPosition[],
  previousPositions?: Map<string, TrainPosition>,
  pollMetadata?: PollSnapshotMetadata
): void
```

**Responsibilities:**
1. Create new meshes for trains without one
2. Update positions for existing trains
3. Apply bearing-based rotation
4. Remove meshes for trains no longer in data
5. Validate position updates (detect unrealistic speeds)

**Flow:**
```
For each train in data:
  1. Snap position to railway line
  2. Get previous position (for interpolation)
  3. If mesh exists:
     - Calculate visual position (interpolated)
     - Update currentPosition, targetPosition
     - Update snap states
     - Update lastUpdate timestamp
  4. If no mesh:
     - Clone model from cache
     - Set initial position and scale
     - Add to scene
     - Apply initial rotation
  5. Track active trains

Remove meshes for trains not in activeTrainKeys
```

#### animatePositions()

Called every frame during render loop.

```typescript
animatePositions(): void
```

**Algorithm:**
```
For each train mesh:
  1. Skip if currentPosition === targetPosition
  2. Calculate elapsed time since lastUpdate
  3. Calculate progress = elapsed / interpolationDuration
  4. Clamp progress to [0, 1]
  5. If railway snap available on same line:
     - Interpolate distance along railway
     - Sample position and bearing from railway
  6. Else:
     - Linear interpolation with easeInOutCubic
  7. Convert [lng, lat] to Three.js world position
  8. Apply Z-offset for elevation
  9. Update mesh.position
  10. Apply bearing rotation
  11. If progress >= 1.0:
      - Set currentPosition = targetPosition
      - Update currentSnap = targetSnap
```

#### applyRailwayBearing()

```typescript
applyRailwayBearing(
  mesh: THREE.Group,
  bearing: number,
  reversed: boolean,
  vehicleKey?: string
): void
```

**Calculation:**
```typescript
// MODEL_FORWARD_OFFSET = Math.PI (trains face -X by default)
const rotationRad = (-bearing * Math.PI) / 180 + MODEL_FORWARD_OFFSET;
const finalRotation = reversed ? rotationRad + Math.PI : rotationRad;
mesh.rotation.z = finalRotation;
```

#### applyParkingVisuals()

Called every frame for stopped trains.

```typescript
applyParkingVisuals(): void
```

**Behavior:**
- For trains with `status === 'STOPPED_AT'`:
  - Apply 90-degree perpendicular rotation
  - Calculate and apply parking slot offset
  - Smooth transition over 500ms

#### setTrainOpacities()

```typescript
setTrainOpacities(opacityMap: Map<string, number>): void
```

Updates material opacity for all train meshes based on line selection or stale state.

#### getScreenCandidates()

```typescript
getScreenCandidates(map: MapboxMap): ScreenCandidate[]
```

Projects all train meshes to screen space for hover/click detection.

**Returns:**
```typescript
interface ScreenCandidate {
  vehicleKey: string;
  routeId: string;
  screenPoint: { x: number; y: number };
  radiusPx: number;
}
```

### Configuration Constants

```typescript
const TRAIN_SIZE_METERS = 25;           // Typical commuter train length
const Z_OFFSET_FACTOR = 0.44;           // Elevation multiplier
const MODEL_FORWARD_OFFSET = Math.PI;   // Train models face -X
const LATERAL_OFFSET_BUCKETS = 5;       // Parking slots
const LATERAL_OFFSET_STEP_METERS = 40;  // Space between trains
const MAX_SNAP_DISTANCE_METERS = 200;   // Max distance to snap
const INTERPOLATION_DURATION_MS = 30000; // Full poll cycle
const MIN_INTERPOLATION_DURATION_MS = 1000;
const MAX_TRAIN_SPEED_MS = 83;          // ~300 km/h with buffer
```

---

## 8. Animation System

### Overview

The animation system provides smooth train movement between 30-second polling updates using interpolation.

### Animation Cycle

```
Poll Arrives (T=0)
    │
    ▼
┌─────────────────────────────────┐
│ updateTrainMeshes() called      │
│ - currentPosition = visual pos  │
│ - targetPosition = new API pos  │
│ - lastUpdate = now              │
│ - interpolationDuration = 30s   │
└─────────────────────────────────┘
    │
    ▼
Every Frame (60fps for 30 seconds)
    │
    ▼
┌─────────────────────────────────┐
│ animatePositions() called       │
│ - elapsed = now - lastUpdate    │
│ - progress = elapsed / duration │
│ - interpolate position          │
│ - update mesh.position          │
└─────────────────────────────────┘
    │
    ▼
Poll Arrives (T=30s) → Cycle repeats
```

### Interpolation Function

```typescript
// Ease-in-out cubic for smooth acceleration/deceleration
function easeInOutCubic(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function interpolatePositionSmooth(
  start: [number, number],
  end: [number, number],
  t: number
): [number, number] {
  const easedT = easeInOutCubic(t);
  return [
    start[0] + (end[0] - start[0]) * easedT,
    start[1] + (end[1] - start[1]) * easedT,
  ];
}
```

### Railway-Based Interpolation

When both current and target positions are snapped to the same railway line:

```typescript
if (currentSnap && targetSnap && currentSnap.lineId === targetSnap.lineId) {
  const railway = railwayLines.get(currentSnap.lineId);

  // Interpolate distance along railway (not linear lng/lat)
  const distanceStart = currentSnap.distance;
  const distanceEnd = targetSnap.distance;
  const interpolatedDistance = distanceStart + (distanceEnd - distanceStart) * progress;

  // Sample position and bearing from railway at interpolated distance
  const sample = sampleRailwayPosition(railway, interpolatedDistance);

  interpolatedLngLat = sample.position;
  bearing = sample.bearing;
}
```

**Advantage:** Trains follow the actual track geometry instead of cutting corners with linear interpolation.

### Animation State Diagram

```
                    ┌─────────────┐
                    │   IDLE      │ currentPos === targetPos
                    │ (no motion) │
                    └──────┬──────┘
                           │ New poll arrives
                           ▼
                    ┌─────────────┐
                    │ ANIMATING   │ progress < 1.0
                    │ (moving)    │◄────────────────┐
                    └──────┬──────┘                 │
                           │                        │
          progress >= 1.0  │                        │ New poll arrives
                           ▼                        │ (mid-animation)
                    ┌─────────────┐                 │
                    │ COMPLETED   │─────────────────┘
                    │             │
                    └─────────────┘
```

---

## 9. Railway Geometry & Snapping

**File:** `src/lib/trains/geometry.ts`

### Purpose

Provides utilities for:
- Snapping train GPS positions to railway lines
- Calculating bearing (direction) along track
- Interpolating positions along railway geometry
- Distance calculations

### Data Structures

```typescript
interface PreprocessedRailwayLine {
  segments: RailwaySegment[];
  totalLength: number;  // meters
}

interface RailwaySegment {
  start: [number, number];      // [lng, lat]
  end: [number, number];        // [lng, lat]
  bearing: number;              // degrees 0-360
  startDistance: number;        // cumulative distance from line start
  endDistance: number;          // cumulative distance to segment end
}

interface RailwaySnapResult {
  position: [number, number];   // Snapped [lng, lat]
  bearing: number;              // Track direction at snap point
  distance: number;             // Distance along line (meters)
  metersAway: number;           // Perpendicular distance from track
  lineId: string;               // Railway line identifier
}
```

### Key Functions

#### preprocessRailwayLine()

Converts GeoJSON LineString/MultiLineString to optimized segment format.

```typescript
function preprocessRailwayLine(
  geometry: LineString | MultiLineString
): PreprocessedRailwayLine | null
```

**Process:**
1. Extract coordinate arrays
2. For each pair of consecutive coordinates:
   - Calculate bearing using Haversine
   - Calculate segment length
   - Create RailwaySegment with cumulative distances
3. Return null if no valid segments

#### snapTrainToRailway()

Finds the closest point on a railway line to a train position.

```typescript
function snapTrainToRailway(
  position: [number, number],
  railway: PreprocessedRailwayLine,
  maxDistanceMeters: number = 200
): RailwaySnapResult | null
```

**Algorithm:**
```
1. Convert train position to Cartesian (meters)
2. For each segment:
   a. Project train position onto segment line
   b. Clamp projection to segment bounds
   c. Calculate perpendicular distance
   d. Track closest point
3. If closest distance > maxDistanceMeters:
   return null
4. Return snap result with position, bearing, distance
```

#### sampleRailwayPosition()

Inverse of snapping - get position at a given distance along line.

```typescript
function sampleRailwayPosition(
  railway: PreprocessedRailwayLine,
  distance: number
): { position: [number, number]; bearing: number }
```

**Used for:** Railway-based interpolation during animation.

#### calculateBearing()

Calculates compass bearing between two points.

```typescript
function calculateBearing(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number  // degrees 0-360
```

**Formula (Haversine):**
```
y = sin(Δλ) × cos(φ2)
x = cos(φ1) × sin(φ2) - sin(φ1) × cos(φ2) × cos(Δλ)
θ = atan2(y, x)
bearing = (θ × 180/π + 360) % 360
```

### Coordinate Transformation

```typescript
// Geographic to Cartesian (meters from origin)
function toCartesian(
  point: [number, number],
  origin: [number, number],
  originLatRad: number
): { x: number; y: number }

// Cartesian back to Geographic
function toLngLat(
  cartesian: { x: number; y: number },
  origin: [number, number],
  originLatRad: number
): [number, number]

// Earth radius for calculations
const EARTH_RADIUS_METERS = 6_371_000;
```

---

## 10. Model Management

**File:** `src/lib/trains/modelLoader.ts`

### Caching System

```typescript
const modelCache = new Map<string, GLTF>();
const loadingPromises = new Map<string, Promise<GLTF>>();
const loader = new GLTFLoader();
```

### Functions

#### loadTrainModel()

```typescript
async function loadTrainModel(modelType: TrainModelType): Promise<GLTF>
```

**Behavior:**
1. Check cache - return immediately if found
2. Check loadingPromises - return existing promise if loading
3. Start new load with GLTFLoader
4. Log progress at 25% intervals
5. Cache result and return

#### preloadAllTrainModels()

```typescript
async function preloadAllTrainModels(): Promise<void>
```

Loads all three models in parallel during initialization:
- Series 447
- Series 470
- Civia

#### Other Functions

```typescript
function getCachedModel(modelType: TrainModelType): GLTF | undefined
function isModelLoading(modelType: TrainModelType): boolean
function areAllModelsLoaded(): boolean
function clearModelCache(): void
```

### Model Files

| Type | File | Lines |
|------|------|-------|
| `447` | `/models/447.glb` | R3, R4, R7 |
| `470` | `/models/470.glb` | R13-R17, RG1, RT1, RT2 |
| `civia` | `/models/civia.glb` | R1, R2, R2N, R2S, R8, R11 |

---

## 11. Train Configuration

**File:** `src/config/trainModels.ts`

### Line-to-Model Mapping

```typescript
const LINE_TO_MODEL_MAP: Record<string, TrainModelType> = {
  // Series 447 lines
  'R3': '447',
  'R4': '447',
  'R7': '447',

  // Civia lines (default)
  'R1': 'civia',
  'R2': 'civia',
  'R2N': 'civia',
  'R2S': 'civia',
  'R8': 'civia',
  'R11': 'civia',

  // Series 470 lines (regional)
  'R13': '470',
  'R14': '470',
  'R15': '470',
  'R16': '470',
  'R17': '470',
  'RG1': '470',
  'RT1': '470',
  'RT2': '470',
};
```

### Functions

#### extractLineFromRouteId()

```typescript
function extractLineFromRouteId(routeId: string): string | null
```

**Regex:** `/R[GTLN]?\d+[NS]?/`

**Examples:**
- `"51T0093R11"` → `"R11"`
- `"51T0001R2N"` → `"R2N"`
- `"51T0020R4"` → `"R4"`

#### getModelTypeForRoute()

```typescript
function getModelTypeForRoute(routeId: string): TrainModelType
```

Returns model type based on extracted line code, defaults to `'civia'`.

#### getModelPathForRoute()

```typescript
function getModelPathForRoute(routeId: string): string
```

Returns full path like `/models/447.glb`.

---

## 12. Zoom-Responsive Scaling

**File:** `src/lib/trains/scaleManager.ts`

### Purpose

Keeps trains visually readable at all zoom levels using discrete scale buckets.

### Configuration

```typescript
interface ScaleManagerConfig {
  minHeightPx: number;       // Default: 15
  maxHeightPx: number;       // Default: 50
  targetHeightPx: number;    // Default: 30
  referenceZoom: number;     // Default: 11
  zoomBucketSize: number;    // Default: 0.1
}
```

### Scale Buckets

| Zoom Range | Scale | Purpose |
|------------|-------|---------|
| 0 - 14.99 | 1.0 | Full size for overview |
| 15+ | 0.5 | Half size to avoid obstructing buildings |

### Methods

```typescript
class ScaleManager {
  computeScale(zoom: number): number;
  quantizeZoom(zoom: number): number;
  getCacheStats(): { size, hits, misses, hitRate };
  invalidateCache(): void;
}
```

### Caching

- Zoom values are quantized to bucket size (0.1)
- Cache stores computed scales for each bucket
- Typical hit rate: >95%

**Example:**
```
Zoom 14.73 → Quantized 14.7 → Cache lookup → Scale 1.0
Zoom 14.78 → Quantized 14.8 → Cache lookup → Scale 1.0
Zoom 15.01 → Quantized 15.0 → Cache lookup → Scale 0.5
```

---

## 13. Hover Outlines

**File:** `src/lib/trains/outlineManager.ts`

### Purpose

Visual identification of train line on hover using BackSide material rendering technique.

### Functions

#### buildLineColorMap()

```typescript
function buildLineColorMap(
  lines: RodaliesLine[],
  fallbackColor: string = 'CCCCCC'
): Map<string, THREE.Color>
```

Creates mapping from line codes to Three.js colors.

#### createOutlineMesh()

```typescript
function createOutlineMesh(
  trainMesh: THREE.Group,
  lineColor: THREE.Color,
  scaleFactor: number = 1.12,
  opacity: number = 0.95
): THREE.Group
```

**Technique:**
1. Traverse train mesh hierarchy
2. For each child mesh:
   - Clone geometry
   - Create BackSide material with line color
   - Scale up by 12% (scaleFactor)
3. Return grouped outline
4. Initially invisible

**Material Properties:**
```typescript
new THREE.MeshBasicMaterial({
  color: lineColor,
  side: THREE.BackSide,      // Only render back faces
  transparent: true,
  opacity: 0.95,
  depthTest: true,
  depthWrite: false,         // Prevents z-fighting
});
```

### Usage Flow

```
1. Mouse enters train → resolveScreenHit() finds train
2. If first hover → createOutlineMesh() called (lazy load)
3. outline.visible = true
4. Mouse leaves → outline.visible = false
```

---

## 14. Station Parking

**File:** `src/lib/trains/stationParking.ts`

### Purpose

Position multiple stopped trains at a station without visual overlap.

### Data Structures

```typescript
interface ParkingPosition {
  position: [number, number];  // Offset parking slot
  trackBearing: number;        // Track direction at station
  parkingBearing: number;      // 90° perpendicular
  slotIndex: number;           // Assigned slot (0-4)
  slotOffset: number;          // Signed offset (-2 to +2)
  offsetMeters: number;        // Distance from station center
}

interface ParkingConfig {
  maxSlots: number;            // Default: 5
  baseSpacingMeters: number;   // Default: 20
  referenceZoom: number;       // Default: 14
  zoomScaleFactor: number;     // Default: 0.1
  transitionDurationMs: number; // Default: 500
}
```

### Slot Assignment

```
Station with 5 slots:

     Slot 0    Slot 1    Slot 2    Slot 3    Slot 4
       │         │         │         │         │
       ▼         ▼         ▼         ▼         ▼
    ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐
    │Train│  │Train│  │STATN│  │Train│  │Train│
    │ A   │  │ B   │  │     │  │ C   │  │ D   │
    └─────┘  └─────┘  └─────┘  └─────┘  └─────┘

    Offset: -2    -1      0      +1      +2

    ═══════════════════════════════════════════
                    RAILWAY TRACK
```

### Key Functions

#### getSlotIndex()

```typescript
function getSlotIndex(trainId: string, maxSlots: number): number
```

Deterministic hash ensures same train always gets same slot.

#### slotIndexToOffset()

```typescript
function slotIndexToOffset(slotIndex: number, maxSlots: number): number
```

Converts 0-4 to -2 to +2 range for centering around station.

#### calculateParkingPosition()

```typescript
function calculateParkingPosition(
  stationId: string,
  trainId: string,
  stationCoords: [number, number],
  railwayLine: PreprocessedRailwayLine | null,
  config: ParkingConfig,
  currentZoom: number
): ParkingPosition | null
```

**Algorithm:**
1. Get track bearing at station (from railway snap)
2. Assign slot deterministically (hash of trainId)
3. Convert slot to signed offset
4. Calculate zoom-adjusted spacing
5. Project position along track (min 30m from station marker)
6. Calculate perpendicular bearing (track + 90°)

### Visual Effect

In `applyParkingVisuals()`:
- Trains with `STOPPED_AT` status rotate 90° to face perpendicular to track
- Smooth 500ms transition
- Position offset applied to prevent overlap

---

## 15. Predictive Positioning

**File:** `src/lib/trains/predictiveCalculator.ts`

### Purpose

Calculate predicted positions based on schedule when GPS data is delayed or unavailable.

### Configuration

```typescript
interface PredictiveConfig {
  maxGpsAgeMs: number;      // Default: 60000 (60s)
  freshGpsWeight: number;   // Default: 0.8 (80% GPS when fresh)
  minConfidence: number;    // Default: 0.3
  debug: boolean;
}
```

### Key Function

```typescript
function calculateProgress(
  train: TrainPosition,
  tripDetails: TripDetails,
  currentTimeSeconds: number
): number  // 0 = at previous stop, 1 = at next stop
```

**Algorithm:**
1. Find previous and next stop in trip schedule
2. Get predicted (or scheduled) departure/arrival times
3. Calculate: `(currentTime - departureTime) / (arrivalTime - departureTime)`
4. Clamp to [0, 1]

### Integration

```typescript
// In TrainMeshManager
meshManager.setTripDetails(tripId, tripDetails);
meshManager.setPredictiveConfig(config);

// Tracks source for each train
lastPredictiveSource: 'gps' | 'predicted' | 'blended'
predictiveConfidence: number  // 0-1
```

---

## 16. Train State Management

**File:** `src/state/trains/`

### Store Structure

```typescript
interface TrainState {
  selectedTrain: Train | null;
  isPanelOpen: boolean;
}

interface TrainActions {
  selectTrain: (train: Train) => void;
  clearSelection: () => void;
}
```

### Hooks

```typescript
// Access state
const { selectedTrain, isPanelOpen } = useTrainState();

// Access actions
const { selectTrain, clearSelection } = useTrainActions();
```

### Usage Pattern

```typescript
// When user clicks a train
const handleTrainClick = async (vehicleKey: string) => {
  const trainData = await fetchTrainByKey(vehicleKey);
  selectTrain(trainData);
  setActivePanel('trainInfo');
};

// When user closes panel
const handleClose = () => {
  clearSelection();
  setActivePanel('none');
};
```

---

## 17. Backend API

**File:** `apps/api/handlers/trains.go`

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/trains` | All trains (with optional route filter) |
| GET | `/api/trains/positions` | Lightweight positions for polling |
| GET | `/api/trains/{vehicleKey}` | Single train details |
| GET | `/api/trips/{tripId}` | Trip schedule details |

### Response Headers

```go
// Caching
w.Header().Set("Cache-Control", "max-age=15, stale-while-revalidate=10")
w.Header().Set("Content-Type", "application/json")
```

### Error Responses

```json
{
  "error": "Train not found",
  "details": "vehicleKey: 12345"
}
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request (missing/invalid params) |
| 404 | Train/trip not found |
| 500 | Database or server error |

---

## 18. Database Schema

### Table: `rt_rodalies_vehicle_current`

```sql
CREATE TABLE rt_rodalies_vehicle_current (
  vehicle_key VARCHAR PRIMARY KEY,
  vehicle_id VARCHAR NOT NULL,
  vehicle_label VARCHAR NOT NULL,
  entity_id VARCHAR,
  trip_id VARCHAR,
  route_id VARCHAR NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  current_stop_id VARCHAR,
  previous_stop_id VARCHAR,
  next_stop_id VARCHAR,
  next_stop_sequence INTEGER,
  status VARCHAR NOT NULL,
  arrival_delay_seconds INTEGER,
  departure_delay_seconds INTEGER,
  schedule_relationship VARCHAR,
  predicted_arrival_utc TIMESTAMP,
  predicted_departure_utc TIMESTAMP,
  vehicle_timestamp_utc TIMESTAMP,
  polled_at_utc TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  snapshot_id VARCHAR,
  trip_update_timestamp_utc TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX idx_route_id ON rt_rodalies_vehicle_current(route_id);
CREATE INDEX idx_polled_at ON rt_rodalies_vehicle_current(polled_at_utc);
CREATE INDEX idx_status ON rt_rodalies_vehicle_current(status);
```

### Data Validation

- `vehicle_label` must start with 'R' (Rodalies trains only)
- `latitude` must be in range [-90, 90]
- `longitude` must be in range [-180, 180]
- Null coordinates are allowed (some trains don't report GPS)

---

## 19. Performance Characteristics

| Operation | Target | Implementation |
|-----------|--------|----------------|
| GET /api/trains/positions | <50ms | Lightweight query, ~1KB/train |
| GET /api/trains | <100ms | Full train data with route filter |
| GET /api/trains/{key} | <10ms | Primary key lookup |
| Model load (single) | ~500ms | Cached after first load |
| Model load (all 3) | ~1000ms | Parallel on init |
| Render frame (100 trains) | <16.67ms | 60 FPS target |
| Interpolation | 30s smooth | easeInOutCubic |
| Scale cache hit rate | >95% | Quantized zoom buckets |

### Memory Usage

- Train mesh: ~2-5KB per train (depending on model complexity)
- 100 trains: ~500KB mesh data
- Model cache: ~10MB for all 3 models
- Trip cache: ~50KB at max capacity (200 entries)

---

## 20. Configuration Constants

### Polling & Timing

```typescript
POLLING_INTERVAL_MS = 30000          // 30 seconds
STALE_DATA_THRESHOLD_MS = 60000      // 60 seconds
INTERPOLATION_DURATION_MS = 30000    // Full poll cycle
MIN_INTERPOLATION_DURATION_MS = 1000 // Minimum animation time
```

### Physics & Sizing

```typescript
TRAIN_SIZE_METERS = 25               // Typical train length
Z_OFFSET_FACTOR = 0.44               // Elevation multiplier
MODEL_FORWARD_OFFSET = Math.PI       // Rotation correction
MAX_TRAIN_SPEED_MS = 83              // ~300 km/h limit
MAX_SNAP_DISTANCE_METERS = 200       // Max snap distance
EARTH_RADIUS_METERS = 6_371_000      // For calculations
```

### Parking

```typescript
maxSlots = 5                         // Parking slots per station
baseSpacingMeters = 20               // Between parked trains
referenceZoom = 14                   // Reference for scaling
zoomScaleFactor = 0.1                // Scale adjustment
transitionDurationMs = 500           // Smooth transition
minOffsetMeters = 30                 // Min distance from station
```

### Scaling

```typescript
minHeightPx = 15                     // Minimum visible size
maxHeightPx = 50                     // Maximum size
targetHeightPx = 30                  // Reference height
zoomBucketSize = 0.1                 // Cache granularity
```

### Retry

```typescript
maxAttempts = 3                      // API retry attempts
baseDelay = 1000                     // Initial retry delay (ms)
maxDelay = 5000                      // Max retry delay (ms)
// Exponential backoff: 1s, 2s, 4s
// Jitter: delay × (1 + random × 0.5)
```

---

## 21. Error Handling

### Network Failures

```typescript
// Exponential backoff with jitter
const retryDelayMs = Math.min(
  baseDelay * Math.pow(2, retryCount),
  maxDelay
);
const jitter = retryDelayMs * Math.random() * 0.5;
await sleep(retryDelayMs + jitter);
```

- Max 5 retries before giving up
- Manual retry button for users
- Graceful degradation (show last known positions)

### GPS Issues

- Null coordinates filtered out server-side and client-side
- Logged separately: `[POLL] X trains filtered out (null coords)`
- Fallback to predictive positioning if trip data available

### Stale Data

- Detected when `polledAt` > 60 seconds old
- Visual indicator: 50% opacity reduction
- Warning logged to console

### Speed Anomalies

```typescript
const MAX_TRAIN_SPEED_MS = 83;  // ~300 km/h

// In updateTrainMeshes
const distance = calculateDistance(previousPos, currentPos);
const timeSeconds = (now - lastUpdate) / 1000;
const speedMs = distance / timeSeconds;

if (speedMs > MAX_TRAIN_SPEED_MS) {
  meshData.hasUnrealisticSpeed = true;
  // Optional warning indicator sprite
}
```

### Railway Snapping Failures

- Returns null if no point within `MAX_SNAP_DISTANCE_METERS`
- Falls back to raw GPS position
- Linear interpolation instead of railway-based

---

## 22. Debugging & Monitoring

### Debug Overlay

Enable with URL parameter: `?debug=true`

Features:
- Canvas overlay showing clickable areas
- Red circles for normal trains
- Green circles for hovered train
- Vehicle key and route ID on hover

### Performance Logging

Every 5 seconds:
```
[Performance] Trains: 29 | FPS: 60.0 | Frame: 2.45ms (min: 1.2ms, max: 8.3ms) | Renders: 300
[ScaleCache] Size: 15 | Hits: 298 | Misses: 2 | Hit Rate: 99.3%
```

Warnings:
```
[Performance] Low FPS detected (28.5). Consider reducing train count.
[Performance] Frame drops detected (max: 45.2ms). Some frames taking >33ms.
[ScaleCache] Low cache hit rate (85.0%). Expected >95% for optimal performance.
```

### Console Logging

```
// Data loading
TrainLayer3D: Loaded 156 stations for bearing calculations
TrainLayer3D: Preprocessed 12 railway lines for snapping
TrainLayer3D: All train models loaded and ready

// Train updates
[POLL] Train changes: +2 new, -1 removed
[POLL] 3 trains filtered out (null coords): [12345, 12346, 12347]

// Stale data
TrainLayer3D: Data is stale (age: 65s)

// Retries
TrainLayer3D: Retrying in 4s (attempt 2/5)
```

### Cache Statistics

```typescript
// Scale cache
const stats = scaleManager.getCacheStats();
// { size: 15, hits: 298, misses: 2, hitRate: 0.993 }

// Trip cache
const tripStats = tripCache.getStats();
// { size: 45, hits: 120, misses: 12, hitRate: 0.909, pendingRequests: 0 }
```

---

## 23. Known Issues & Limitations

### Train Teleportation

**Issue:** Trains may appear to "teleport" when a new poll arrives instead of smoothly animating.

**Cause:** The animation system calculates where the train should be based on interpolation progress, but discrepancies can occur when:
- The calculated visual position doesn't match the actual mesh position
- Railway snapping produces slightly different results
- Poll timing varies

**Mitigation:** The current implementation attempts to use the interpolated visual position as the starting point for the next animation segment.

### Stuck Trains

**Issue:** Some trains appear "stuck" with `currentPosition === targetPosition` even though they're not stopped.

**Cause:** When animation completes (progress >= 1.0), both positions become equal. If the next poll arrives late or with the same coordinates, the train won't move.

**Diagnostic:** Console warning shows stuck train count.

### Railway Snapping Edge Cases

- Trains may not snap if >200m from any railway line
- Snapping fails at junctions where multiple lines intersect
- Direction detection unreliable when train reverses direction

### Model Orientation

- Train models face -X axis by default
- `MODEL_FORWARD_OFFSET = Math.PI` corrects this
- Some edge cases may show incorrect orientation when reversing

### Performance at Scale

- Tested to ~100 trains at 60 FPS
- Performance degrades beyond ~200 trains
- Consider LOD (Level of Detail) for distant trains

### Mobile Considerations

- Touch interaction not optimized (uses mouse events)
- 3D rendering may be heavy on older mobile devices
- Consider 2D fallback for low-end devices

---

## Appendix: File Reference

| File | Purpose |
|------|---------|
| `src/types/trains.ts` | TypeScript type definitions |
| `src/lib/api/trains.ts` | API client functions |
| `src/lib/trains/tripCache.ts` | Trip data caching |
| `src/features/trains/TrainLayer3D.tsx` | Main rendering component |
| `src/lib/trains/trainMeshManager.ts` | Mesh lifecycle management |
| `src/lib/trains/geometry.ts` | Railway geometry utilities |
| `src/lib/trains/modelLoader.ts` | 3D model loading |
| `src/lib/trains/scaleManager.ts` | Zoom-responsive scaling |
| `src/lib/trains/outlineManager.ts` | Hover outline effects |
| `src/lib/trains/stationParking.ts` | Parking position calculation |
| `src/lib/trains/predictiveCalculator.ts` | Schedule-based positioning |
| `src/config/trainModels.ts` | Line-to-model mapping |
| `src/state/trains/` | Train selection state |
| `apps/api/handlers/trains.go` | Backend API handlers |
| `apps/api/models/train.go` | Backend data model |

---

## 24. Animation Regression Analysis (post-004-station-visualization)

Comparing the current animation stack (HEAD `6dac067`) to the pre-004 baseline (`9d7264b` right before merging `004-station-visualization`) to isolate the popping/teleportation regressions:

- **Poll update pipeline changes**  
  - Before: `updateTrainMeshes` always re-based the animation start at the previous poll’s raw GPS (`previousPositions`), snapping only for the new target; interpolation always ran from “previous poll → new poll”.  
  - Now (`apps/web/src/lib/trains/trainMeshManager.ts`): re-bases the start position to the *current visual/interpolated* position computed at poll time, and uses snapped previous coords instead of raw. This avoids back-jumps mid-interpolation but means any stale `currentSnap/targetSnap` mismatch now feeds into the new start point.

- **Update call frequency**  
  - Before: `TrainLayer3D` called `updateTrainMeshes` in two effects (manager creation and train updates), effectively twice per poll but benign because the data path was simpler.  
  - Now (`apps/web/src/features/trains/TrainLayer3D.tsx`): manager creation no longer calls `updateTrainMeshes`; all updates go through the train effect, and `updateTrainMeshes` logs if called >1x/sec. Any remaining double-call (e.g., rapid re-renders) will reset `lastUpdate` twice and can zero-out progress, making trains snap to targets.

- **Per-frame overrides for STOPPED trains**  
  - Before: parking offsets were applied once on poll in `updateTrainMeshes`; `animatePositions` never overwrote mesh positions for stopped trains.  
  - Now: a new per-frame `applyParkingVisuals()` runs after `animatePositions`, recomputing parking offsets and rotating 90° every frame for `STOPPED_AT`. Transitions into/out of STOPPED now depend on status timing; if a train flips status between frames, the parking override can jump the mesh to/from the slot position, bypassing the poll interpolation path.

- **State tracked on meshes**  
  - New fields on `TrainMeshData` (parking rotation flags, parking position, stopped station id, tripId/nextStopId scaffolding) didn’t exist pre-004. These flags are mutated inside `applyRailwayBearing` and `applyParkingVisuals`; stale flags can block reapplication of parking rotation or clear it unexpectedly.

- **Bearing/source handling**  
  - Bearing application now resets the parking rotation flag (`applyRailwayBearing` signature now receives the vehicle key). `animatePositions` also copies `targetPosition` when finishing interpolation to avoid shared references. These mutations were absent pre-004 and can influence how the next poll computes the “current visual position” that seeds the new segment.

**Regression suspects for popping/teleportation**
1) Any double invocation of `updateTrainMeshes` within a poll window now re-bases from a partially interpolated state and resets `lastUpdate`, which can zero progress and make meshes jump.  
2) `applyParkingVisuals` overwriting positions every frame for STOPPED trains can fight the normal interpolation when status flips during a poll, causing instant moves on STOPPED↔IN_TRANSIT transitions.  
3) Re-basing from the interpolated position plus snapped previous coords means mismatched or stale snap states (line id change, snap miss) now alter the starting point, potentially jumping the mesh to the snap sample instead of the last drawn position.

**Mitigation applied (current HEAD)**
- When parking is first applied, logical `currentPosition`/`targetPosition` are now set to the parked slot and snap data is cleared, so the next poll starts from the drawn parking location instead of a stale track-aligned coordinate. This prevents STOPPED→IN_TRANSIT teleports caused by stale positions.
- Guard added to ignore duplicate/older poll updates (based on polledAt/receivedAt timestamps) to avoid resetting interpolation mid-flight when fetches arrive twice for the same poll.
- Dev-only poll log pipeline: if `LOG_POLLS_TO_FILE=true` and `VITE_LOG_POLLS_TO_FILE=true` in dev, the app POSTs a concise per-poll summary to `/__poll-log`, and Vite appends JSON lines to `apps/web/poll-debug.log` for offline debugging.
- Optional per-train watch logging: set `VITE_POLL_DEBUG_WATCH_KEYS` (comma-separated vehicle keys) to append detailed per-poll data for those trains into the same `poll-debug.log` (includes start/visual/target positions and snap state).
