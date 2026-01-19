# Transit Position & Animation Algorithm

This document explains how MiniBarcelona3D calculates and animates vehicle positions for all transit networks. The system handles three fundamentally different data sources with a unified visualization layer.

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Rodalies: Real-time GTFS-RT](#3-rodalies-real-time-gtfs-rt)
4. [Metro: TMB iMetro API](#4-metro-tmb-imetro-api)
5. [Bus, FGC, Tram: Static Schedule Simulation](#5-bus-fgc-tram-static-schedule-simulation)
6. [Shared Components](#6-shared-components)
7. [Key Files Reference](#7-key-files-reference)
8. [Performance Characteristics](#8-performance-characteristics)

---

## 1. System Overview

### Three Data Sources, One Visualization

| Network | Data Source | Position Type | Accuracy | Update Frequency |
|---------|-------------|---------------|----------|------------------|
| **Rodalies** | Renfe GTFS-RT | Real-time GPS | High (±meters) | 30 seconds |
| **Metro** | TMB iMetro API | Estimated from arrival times | Medium (±station) | 30 seconds |
| **Bus/FGC/Tram** | Static schedules | Simulated from headway | Low (deterministic) | 30 seconds |

### Key Concepts

- **Polling**: Backend fetches data every 30 seconds
- **Interpolation**: Frontend smoothly animates between updates at 60fps
- **Railway Snapping**: Vehicles snap to track geometry for visual accuracy
- **Predictive Positioning**: When GPS is stale, positions are estimated from schedules

---

## 2. Architecture

### High-Level Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         DATA SOURCES                                     │
├─────────────────┬─────────────────────┬─────────────────────────────────┤
│  Renfe GTFS-RT  │   TMB iMetro API    │     GTFS Static Schedules       │
│  (Vehicle GPS)  │   (Arrival Times)   │    (Headway + Speed Data)       │
└────────┬────────┴──────────┬──────────┴──────────────┬──────────────────┘
         │                   │                         │
         ▼                   ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      POLLER SERVICE (Go)                                 │
│  apps/poller/internal/realtime/                                          │
│  ├─ rodalies/client.go    Parse GTFS-RT protobuf, extract positions     │
│  ├─ metro/client.go       Fetch arrivals, estimate positions            │
│  └─ schedule/estimator.go Calculate positions from static schedules     │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      SQLite DATABASE                                     │
│  rt_rodalies_vehicle_current    Current Rodalies positions              │
│  rt_metro_vehicle_current       Current Metro positions                  │
│  rt_schedule_vehicle_current    Current Bus/FGC/Tram positions          │
│  *_history tables               Previous positions for interpolation    │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      API SERVICE (Go)                                    │
│  apps/api/handlers/                                                      │
│  GET /api/trains/positions      Rodalies positions                       │
│  GET /api/metro/positions       Metro positions                          │
│  GET /api/transit/schedule      Bus/FGC/Tram positions                   │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      FRONTEND (React + Three.js)                         │
│  Polling Hooks          useTrainPositions, useMetroPositions, etc.      │
│  Mesh Managers          TrainMeshManager, TransitMeshManager            │
│  Animation Loop         60fps interpolation + railway snapping          │
│  3D Rendering           Three.js Custom Layer on Mapbox GL              │
└─────────────────────────────────────────────────────────────────────────┘
```

### Polling & Animation Timeline

```
Time (seconds):  0        15       30       45       60
                 │        │        │        │        │
Backend Poll:    ●────────────────●────────────────●
                 │                 │                │
Frontend Poll:   ●────────────────●────────────────●
                 │                 │                │
Animation:       ├─smooth interp─►├─smooth interp─►├─
                 60fps            60fps            60fps
```

---

## 3. Rodalies: Real-time GTFS-RT

Rodalies uses **real-time GPS data** from Renfe's GTFS-RT feed. This is the most accurate positioning system.

### Data Flow

```
Renfe GTFS-RT API
├─ vehicle_positions.pb   → GPS coordinates + status
└─ trip_updates.pb        → Delays and predictions
         │
         ▼
Poller: rodalies/client.go
├─ Parse protobuf feeds
├─ Extract vehicle identity from label ("R4-77626-PLATF.(1)")
├─ Merge position with delay data
├─ Derive previous stop from GTFS static schedule
└─ Store in rt_rodalies_vehicle_current
         │
         ▼
API: /api/trains/positions
├─ Returns current + previous positions
└─ Previous positions enable smooth animation
         │
         ▼
Frontend: TrainMeshManager
├─ Create/update 3D train meshes
├─ Interpolate between positions (30s window)
├─ Snap to railway geometry
└─ Apply bearing rotation
```

### Position Extraction (Backend)

**File**: `apps/poller/internal/realtime/rodalies/client.go`

```go
// For each vehicle entity in GTFS-RT feed:
func (p *Poller) processVehicleEntity(entity *gtfsrt.FeedEntity) {
    vehicle := entity.Vehicle

    // 1. Extract identity
    vehicleKey := vehicle.Vehicle.GetId()
    vehicleLabel := vehicle.Vehicle.GetLabel()  // "R4-77626-PLATF.(1)"
    routeId := extractLineCode(vehicleLabel)    // "R4"

    // 2. Extract GPS position (nullable - not all trains report)
    latitude := float64(vehicle.Position.GetLatitude())
    longitude := float64(vehicle.Position.GetLongitude())

    // 3. Determine status (affects stop ID meaning)
    status := StatusMap[vehicle.GetCurrentStatus()]
    // STOPPED_AT: train is at the stop
    // IN_TRANSIT_TO: train is headed to the stop
    // INCOMING_AT: train is approaching the stop

    // 4. Extract stop context
    if status == "STOPPED_AT" {
        currentStopId = vehicle.GetStopId()  // We're AT this stop
    } else {
        nextStopId = vehicle.GetStopId()     // We're GOING TO this stop
    }

    // 5. Derive previous stop from GTFS static schedule
    previousStopId = db.GetPreviousStop(tripId, currentStopId)
}
```

### Animation & Interpolation (Frontend)

**File**: `apps/web/src/lib/trains/trainMeshManager.ts`

The frontend receives position updates every 30 seconds. To achieve smooth 60fps animation:

```typescript
class TrainMeshManager {
  // Called when new positions arrive from API
  updateTrainMesh(position: TrainPosition, now: number): void {
    let meshData = this.trainMeshes.get(position.vehicleKey);

    if (!meshData) {
      // Create new mesh
      meshData = {
        mesh: this.createMesh(position),
        currentPosition: [position.longitude, position.latitude],
        targetPosition: [position.longitude, position.latitude],
        lastUpdate: now,
        interpolationDuration: 30000,  // 30 seconds
      };
    } else {
      // Update existing mesh - chain animation
      meshData.currentPosition = meshData.targetPosition;
      meshData.targetPosition = [position.longitude, position.latitude];
      meshData.lastUpdate = now;
    }
  }

  // Called every frame (60fps) in Three.js render loop
  updateMeshPositions(now: number): void {
    for (const meshData of this.trainMeshes.values()) {
      // Calculate interpolation progress
      const elapsed = now - meshData.lastUpdate;
      const t = Math.min(elapsed / meshData.interpolationDuration, 1.0);
      const eased = easeInOutCubic(t);

      // Interpolate position
      const position = [
        meshData.currentPosition[0] + eased * (meshData.targetPosition[0] - meshData.currentPosition[0]),
        meshData.currentPosition[1] + eased * (meshData.targetPosition[1] - meshData.currentPosition[1]),
      ];

      // Snap to railway geometry
      const snapResult = snapTrainToRailway(position, railway, 200);

      // Update mesh
      meshData.mesh.position.set(...getModelPosition(snapResult.position));
      meshData.mesh.rotation.z = snapResult.bearing * (Math.PI / 180);
    }
  }
}
```

### Railway Snapping

**File**: `apps/web/src/lib/trains/geometry.ts`

When GPS coordinates deviate from tracks (common with low-precision GPS), we snap vehicles back to the railway:

```typescript
/**
 * Snap a position to the nearest point on a railway line.
 *
 * @param position - Train GPS coordinates [lng, lat]
 * @param railway - Preprocessed railway geometry with segments
 * @param maxDistanceMeters - Maximum snapping distance (default 200m)
 * @returns Snapped position with bearing, or null if too far from any track
 */
function snapTrainToRailway(
  position: Position,
  railway: PreprocessedRailwayLine,
  maxDistanceMeters = 200
): RailwaySnapResult | null {
  let closest: RailwaySnapResult | null = null;

  // For each segment in railway
  for (const segment of railway.segments) {
    // Project position onto segment (find closest point on line)
    const projection = projectPointOntoSegment(position, segment);

    // Calculate distance from original position
    const distance = haversineDistance(position, projection.point);

    if (distance <= maxDistanceMeters) {
      if (!closest || distance < closest.metersAway) {
        closest = {
          position: projection.point,
          bearing: segment.bearing,
          distance: projection.distanceAlongLine,
          metersAway: distance,
        };
      }
    }
  }

  return closest;
}
```

### Predictive Positioning

**File**: `apps/web/src/lib/trains/predictiveCalculator.ts`

When GPS data is stale (>60 seconds old), we estimate position from the schedule:

```typescript
function calculatePredictivePosition(
  train: TrainPosition,
  tripDetails: TripDetails,
  railway: PreprocessedRailwayLine
): PredictedPosition {
  // 1. Calculate schedule-based progress between stops
  const progress = calculateScheduleProgress(train, tripDetails, now);

  // 2. Sample position along railway at that progress
  const path = getPathBetweenStations(
    train.previousStopId,
    train.nextStopId,
    railway
  );
  const predictedPos = sampleRailwayPosition(path, progress * path.totalLength);

  // 3. Blend with GPS if available (weighted by age)
  if (train.latitude && train.longitude) {
    const gpsAge = Date.now() - new Date(train.polledAtUtc).getTime();
    const gpsWeight = calculateGpsWeight(gpsAge, 60000, 0.8);

    if (gpsWeight > 0.1) {
      return blendPositions(predictedPos, [train.longitude, train.latitude], gpsWeight);
    }
  }

  return predictedPos;
}

// GPS weight decays exponentially with age
function calculateGpsWeight(ageMs: number, maxAgeMs: number, freshWeight: number): number {
  if (ageMs <= 0) return freshWeight;
  if (ageMs >= maxAgeMs) return 0;
  return freshWeight * Math.exp(-3 * ageMs / maxAgeMs);
}
```

### Key Data Structures

```typescript
// API Response
interface TrainPosition {
  vehicleKey: string;              // Unique identifier
  latitude: number | null;         // GPS latitude (nullable)
  longitude: number | null;        // GPS longitude (nullable)
  currentStopId?: string | null;   // Station if STOPPED_AT
  previousStopId?: string | null;  // Last departed station
  nextStopId: string | null;       // Next station
  routeId: string | null;          // Line code (e.g., "R1")
  status: VehicleStatus;           // STOPPED_AT | IN_TRANSIT_TO | INCOMING_AT
  polledAtUtc: string;             // When backend fetched this
  predictedArrivalUtc?: string;    // Predicted arrival at next stop
}

// Internal mesh state
interface TrainMeshData {
  mesh: THREE.Group;
  vehicleKey: string;
  currentPosition: [number, number];
  targetPosition: [number, number];
  lastUpdate: number;
  interpolationDuration: number;
  currentSnap?: RailwaySnapState;
  status: string;
  tripId?: string;
}
```

---

## 4. Metro: TMB iMetro API

Metro uses the **TMB iMetro API** which provides arrival predictions, not GPS positions. We estimate positions by interpolating backwards from the next station.

### How Metro Differs from Rodalies

| Aspect | Metro | Rodalies |
|--------|-------|----------|
| Data Source | TMB iMetro API (arrival times) | Renfe GTFS-RT (GPS) |
| Position Data | Seconds-to-arrival | Exact lat/lon |
| Calculation | Backward interpolation | Direct GPS |
| Accuracy | ±station level | ±meters |
| Availability | 5-minute prediction window | Continuous real-time |

### Position Estimation Algorithm

**File**: `apps/poller/internal/realtime/metro/client.go`

The iMetro API returns arrival predictions like "Train 12345 arriving at Hospital Clinic in 45 seconds". We convert this to a position:

```go
func (p *Poller) estimatePosition(arrival TrainArrival) EstimatedPosition {
    station := p.stations[arrival.StationCode]
    line := p.lineGeometries[arrival.LineCode]

    if arrival.SecondsToNext <= 30 {
        // Train is at or very near station
        return EstimatedPosition{
            Latitude:  station.Latitude,
            Longitude: station.Longitude,
            Status:    "ARRIVING",
            Progress:  1.0,
        }
    }

    // Train is in transit - estimate position
    // Assume 120 seconds between stations on average
    progress := 1.0 - (float64(arrival.SecondsToNext) / 120.0)
    progress = max(0.0, min(1.0, progress))

    // Find station position in line geometry
    stationIdx := findClosestPointIndex(line.Coordinates, station)

    // Travel backwards from station by (1-progress) fraction
    pointsBack := int((1 - progress) * float64(min(stationIdx, 20)))

    // Interpolate position
    prevCoord := line.Coordinates[stationIdx-pointsBack]
    nextCoord := line.Coordinates[stationIdx]

    position := interpolate(prevCoord, nextCoord, progress)
    bearing := calculateBearing(prevCoord, nextCoord)

    return EstimatedPosition{
        Latitude:  position[1],
        Longitude: position[0],
        Bearing:   bearing,
        Status:    "IN_TRANSIT_TO",
        Progress:  progress,
        Confidence: getConfidence(arrival.SecondsToNext),
    }
}

func getConfidence(seconds int) string {
    if seconds < 60 {
        return "high"    // Very close, high confidence
    } else if seconds < 300 {
        return "medium"  // Within 5 minutes
    }
    return "low"         // Further out, less accurate
}
```

### Animation (Frontend)

**File**: `apps/web/src/lib/transit/scheduleInterpolator.ts`

Metro uses a `VehicleAnimationManager` for smooth animation:

```typescript
class VehicleAnimationManager {
  private states: Map<string, VehicleAnimationState> = new Map();
  private defaultDuration = 4500;  // 4.5 second animation

  // Called when new position arrives from API
  updateTarget(
    vehicleKey: string,
    targetPosition: [number, number],
    targetBearing: number,
    durationMs?: number
  ): void {
    const existing = this.states.get(vehicleKey);

    if (existing) {
      // Chain from current interpolated position
      const currentPos = this.getInterpolatedPosition(vehicleKey, Date.now());
      existing.currentPosition = currentPos || existing.targetPosition;
      existing.currentBearing = this.getInterpolatedBearing(vehicleKey, Date.now()) || existing.targetBearing;
    }

    this.states.set(vehicleKey, {
      vehicleKey,
      currentPosition: existing?.currentPosition || targetPosition,
      targetPosition,
      currentBearing: existing?.currentBearing || targetBearing,
      targetBearing,
      lastUpdate: Date.now(),
      interpolationDuration: durationMs || this.defaultDuration,
    });
  }

  // Called every frame
  getInterpolatedPosition(vehicleKey: string, currentTimeMs: number): Position | null {
    const state = this.states.get(vehicleKey);
    if (!state) return null;

    const elapsed = currentTimeMs - state.lastUpdate;
    const t = Math.min(elapsed / state.interpolationDuration, 1.0);
    const eased = easeInOutCubic(t);

    return [
      state.currentPosition[0] + eased * (state.targetPosition[0] - state.currentPosition[0]),
      state.currentPosition[1] + eased * (state.targetPosition[1] - state.currentPosition[1]),
    ];
  }

  // Bearing interpolation with 360° wrap-around
  getInterpolatedBearing(vehicleKey: string, currentTimeMs: number): number | null {
    const state = this.states.get(vehicleKey);
    if (!state) return null;

    const elapsed = currentTimeMs - state.lastUpdate;
    const t = Math.min(elapsed / state.interpolationDuration, 1.0);
    const eased = easeInOutCubic(t);

    return interpolateBearing(state.currentBearing, state.targetBearing, eased);
  }
}

// Handle 360° wrap-around (e.g., 359° → 1° should go through 0°)
function interpolateBearing(from: number, to: number, t: number): number {
  from = ((from % 360) + 360) % 360;
  to = ((to % 360) + 360) % 360;

  let diff = to - from;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;

  return ((from + diff * t) % 360 + 360) % 360;
}
```

---

## 5. Bus, FGC, Tram: Static Schedule Simulation

Bus, FGC, and Tram use **static schedule data** (headway intervals and average speeds) to simulate positions. There's no real-time GPS.

### How It Works

Instead of receiving real-time positions, we calculate deterministic positions based on:
- Route geometry (from GeoJSON)
- Headway interval (time between vehicles)
- Average speed (accounting for stops)
- Current time of day

### Position Simulation Algorithm

**File**: `apps/web/src/lib/transit/positionSimulatorFactory.ts`

```typescript
function generateLinePositions(
  lineCode: string,
  config: LineConfig,
  geometry: PreprocessedRailwayLine,
  currentTimeMs: number
): VehiclePosition[] {
  const positions: VehiclePosition[] = [];

  // 1. Calculate how many vehicles are on the line
  const avgSpeedMs = (config.avgSpeedKmh * 1000) / 3600;  // Convert to m/s
  const tripTimeSeconds = geometry.totalLength / avgSpeedMs;
  const vehiclesPerDirection = Math.ceil(tripTimeSeconds / config.headwaySeconds);

  // 2. Calculate spacing between vehicles
  const spacing = geometry.totalLength / vehiclesPerDirection;

  // 3. Calculate time-based offset (vehicles move as time passes)
  const headwayMs = config.headwaySeconds * 1000;
  const timeOffset = (currentTimeMs % headwayMs) / headwayMs;

  // 4. Generate positions for each direction
  for (const direction of [0, 1]) {  // 0 = outbound, 1 = return
    for (let i = 0; i < vehiclesPerDirection; i++) {
      // Base distance for this vehicle
      const baseDistance = i * spacing;

      // Add time-based offset (vehicles progress through route)
      const adjustedDistance = (baseDistance + timeOffset * spacing) % geometry.totalLength;

      // For return direction, measure from opposite end
      const finalDistance = direction === 0
        ? adjustedDistance
        : geometry.totalLength - adjustedDistance;

      // Sample position from geometry
      const { position, bearing } = sampleRailwayPosition(geometry, finalDistance);

      // Adjust bearing for return direction
      const finalBearing = direction === 1 ? (bearing + 180) % 360 : bearing;

      positions.push({
        vehicleKey: `${lineCode}-${direction}-${i}`,
        networkType: config.network,
        routeId: lineCode,
        latitude: position[1],
        longitude: position[0],
        bearing: finalBearing,
        direction,
        source: 'schedule',
        confidence: 'low',
      });
    }
  }

  return positions;
}
```

### Example Calculation

```
Bus Route 23:
├─ Route length: 12 km = 12,000 meters
├─ Average speed: 15 km/h = 4.17 m/s
├─ Headway: 10 minutes = 600 seconds
│
├─ Trip time: 12,000 / 4.17 = 2,880 seconds
├─ Vehicles per direction: ceil(2,880 / 600) = 5 buses
├─ Spacing: 12,000 / 5 = 2,400 meters
│
At time 15:30:00 UTC:
├─ Time in headway cycle: (15:30:00 % 600s) = 120 seconds
├─ Time offset: 120 / 600 = 0.2 (20% through cycle)
│
Vehicle positions:
├─ Bus 0: (0 + 0.2 * 2400) % 12000 = 480m from start
├─ Bus 1: (2400 + 480) % 12000 = 2,880m from start
├─ Bus 2: (4800 + 480) % 12000 = 5,280m from start
├─ Bus 3: (7200 + 480) % 12000 = 7,680m from start
├─ Bus 4: (9600 + 480) % 12000 = 10,080m from start
│
Total: 10 buses (5 per direction)
```

### Configuration Examples

**Bus** (`apps/web/src/config/busConfig.ts`):
```typescript
// High-frequency network (H/V/D lines)
{ headwaySeconds: 360, avgSpeedKmh: 14 }  // 6 min, 14 km/h

// Regular routes
{ headwaySeconds: 600, avgSpeedKmh: 15 }  // 10 min, 15 km/h

// Night routes
{ headwaySeconds: 1200, avgSpeedKmh: 18 } // 20 min, 18 km/h
```

**Tram** (`apps/web/src/config/tramConfig.ts`):
```typescript
T1: { headwaySeconds: 360, avgSpeedKmh: 18 }  // 6 min
T5: { headwaySeconds: 480, avgSpeedKmh: 20 }  // 8 min
```

**FGC** (`apps/web/src/config/fgcConfig.ts`):
```typescript
// Urban lines
L6: { headwaySeconds: 300, avgSpeedKmh: 25 }   // 5 min

// Suburban lines
S1: { headwaySeconds: 600, avgSpeedKmh: 45 }   // 10 min

// Regional express
R50: { headwaySeconds: 3600, avgSpeedKmh: 65 } // 60 min
```

### Animation Modes

**File**: `apps/web/src/lib/transit/transitMeshManager.ts`

The `TransitMeshManager` supports two animation modes:

#### Mode 1: Continuous Motion (Speed-Based)

When the vehicle has speed and distance data, we calculate position every frame:

```typescript
function animateContinuous(meshData: MeshData, now: number): void {
  const elapsedSeconds = (now - meshData.referenceTime) / 1000;
  const distanceTraveled = elapsedSeconds * meshData.speedMetersPerSecond;
  const currentDistance = (meshData.referenceDistance + distanceTraveled) % meshData.lineTotalLength;

  const { position, bearing } = sampleRailwayPosition(meshData.geometry, currentDistance);

  meshData.mesh.position.set(...getModelPosition(position));
  meshData.mesh.rotation.z = bearing * (Math.PI / 180);
}
```

#### Mode 2: Lerp Interpolation (Position-Based)

When we only have start/end positions, we interpolate between them:

```typescript
function animateLerp(meshData: MeshData, now: number): void {
  const elapsed = now - meshData.lerpStartTime;
  const t = Math.min(elapsed / meshData.lerpDuration, 1.0);
  const eased = easeOutCubic(t);

  // If we have pre-computed railway snapping, use distance-based interpolation
  if (meshData.precomputedSnap?.hasValidSnap) {
    const distance = meshData.startDistance +
      (meshData.endDistance - meshData.startDistance) * eased;
    const { position, bearing } = sampleRailwayPosition(meshData.geometry, distance);
    meshData.mesh.position.set(...getModelPosition(position));
    meshData.mesh.rotation.z = bearing * (Math.PI / 180);
  } else {
    // Fallback to straight-line GPS interpolation
    const position = [
      meshData.startPosition[0] + eased * (meshData.targetPosition[0] - meshData.startPosition[0]),
      meshData.startPosition[1] + eased * (meshData.targetPosition[1] - meshData.startPosition[1]),
    ];
    meshData.mesh.position.set(...getModelPosition(position));
  }
}
```

---

## 6. Shared Components

### Geometry Processing

**File**: `apps/web/src/lib/trains/geometry.ts`

All networks share the same geometry processing pipeline:

```typescript
interface PreprocessedRailwayLine {
  segments: RailwaySegment[];      // Line broken into segments
  totalLength: number;              // Total length in meters
  coordinates: Position[];          // Raw coordinate array
  cumulativeDistances: number[];    // Distance at each point
  segmentBearings: number[];        // Bearing for each segment
}

interface RailwaySegment {
  start: Position;                  // Segment start [lng, lat]
  end: Position;                    // Segment end [lng, lat]
  startDistance: number;            // Distance from line start to segment start
  endDistance: number;              // Distance from line start to segment end
  bearing: number;                  // Compass direction (0-360°)
}
```

### Key Geometry Functions

```typescript
// Preprocess GeoJSON LineString into segments for fast lookup
function preprocessRailwayLine(geometry: LineString): PreprocessedRailwayLine;

// Sample position at specific distance along line (O(log n) binary search)
function sampleRailwayPosition(
  railway: PreprocessedRailwayLine,
  distance: number
): { position: Position; bearing: number };

// Calculate compass bearing between two points
function calculateBearing(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number;

// Calculate great-circle distance between two points
function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number;

// Smooth easing function for animation
function easeInOutCubic(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
```

### 3D Rendering

**File**: `apps/web/src/features/trains/TrainLayer3D.tsx`
**File**: `apps/web/src/features/transit/UnifiedTransitLayer3D.tsx`

Both use Mapbox GL JS Custom Layer API with Three.js:

```typescript
const customLayer: mapboxgl.CustomLayerInterface = {
  id: 'transit-3d-layer',
  type: 'custom',
  renderingMode: '3d',

  onAdd(map, gl) {
    // Initialize Three.js scene, camera, renderer
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera();
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl });
  },

  render(gl, matrix) {
    // Called every frame (~60fps)

    // 1. Animate all vehicle meshes
    meshManager.animatePositions(Date.now());

    // 2. Update camera matrix from Mapbox
    this.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix);

    // 3. Render scene
    this.renderer.render(this.scene, this.camera);
  }
};
```

---

## 7. Key Files Reference

### Backend (Go)

| File | Purpose |
|------|---------|
| `apps/poller/cmd/poller/main.go` | Main polling loop (30s interval) |
| `apps/poller/internal/realtime/rodalies/client.go` | Parse Renfe GTFS-RT feeds |
| `apps/poller/internal/realtime/metro/client.go` | Fetch TMB iMetro API, estimate positions |
| `apps/poller/internal/realtime/metro/geometry.go` | Haversine, bearing, interpolation |
| `apps/poller/internal/realtime/schedule/estimator.go` | Static schedule position calculation |
| `apps/api/handlers/trains.go` | `/api/trains/positions` endpoint |
| `apps/api/handlers/metro.go` | `/api/metro/positions` endpoint |
| `apps/api/handlers/transit.go` | `/api/transit/schedule` endpoint |

### Frontend - API Layer

| File | Purpose |
|------|---------|
| `apps/web/src/lib/api/trains.ts` | Fetch Rodalies positions |
| `apps/web/src/lib/api/metro.ts` | Fetch Metro positions |
| `apps/web/src/lib/api/transit.ts` | Fetch Bus/FGC/Tram positions |

### Frontend - Position Calculation

| File | Purpose |
|------|---------|
| `apps/web/src/lib/trains/geometry.ts` | Railway preprocessing, snapping, sampling |
| `apps/web/src/lib/trains/predictiveCalculator.ts` | Predictive positioning for stale GPS |
| `apps/web/src/lib/trains/pathFinder.ts` | Find railway path between stations |
| `apps/web/src/lib/transit/scheduleInterpolator.ts` | Smooth animation interpolation |
| `apps/web/src/lib/transit/positionSimulatorFactory.ts` | Static schedule simulation |

### Frontend - Position Simulators

| File | Purpose |
|------|---------|
| `apps/web/src/lib/bus/positionSimulator.ts` | Bus position generation |
| `apps/web/src/lib/tram/positionSimulator.ts` | Tram position generation |
| `apps/web/src/lib/fgc/positionSimulator.ts` | FGC position generation |
| `apps/web/src/lib/metro/positionSimulator.ts` | Metro fallback simulation |

### Frontend - 3D Rendering

| File | Purpose |
|------|---------|
| `apps/web/src/lib/trains/trainMeshManager.ts` | Rodalies mesh management |
| `apps/web/src/lib/transit/transitMeshManager.ts` | Metro/Bus/FGC/Tram mesh management |
| `apps/web/src/features/trains/TrainLayer3D.tsx` | Rodalies 3D layer component |
| `apps/web/src/features/transit/UnifiedTransitLayer3D.tsx` | Transit 3D layer component |

### Frontend - React Hooks

| File | Purpose |
|------|---------|
| `apps/web/src/features/trains/hooks/useTrainPositions.ts` | Rodalies position polling |
| `apps/web/src/features/transit/hooks/useMetroPositions.ts` | Metro position polling |
| `apps/web/src/features/transit/hooks/useBusPositions.ts` | Bus position polling |
| `apps/web/src/features/transit/hooks/useTramPositions.ts` | Tram position polling |
| `apps/web/src/features/transit/hooks/useFgcPositions.ts` | FGC position polling |

### Frontend - Configuration

| File | Purpose |
|------|---------|
| `apps/web/src/config/busConfig.ts` | Bus headways, speeds, route categorization |
| `apps/web/src/config/tramConfig.ts` | Tram line configurations |
| `apps/web/src/config/fgcConfig.ts` | FGC line configurations |
| `apps/web/src/config/metroConfig.ts` | Metro line configurations |

---

## 8. Performance Characteristics

### Polling & Network

| Metric | Value |
|--------|-------|
| Polling interval | 30 seconds |
| Response size (Rodalies) | ~1-2 KB per train |
| Response size (Metro) | ~0.5 KB per vehicle |
| Response size (Bus/FGC/Tram) | ~0.3 KB per vehicle |
| Target response time | < 50ms |

### Animation Performance

| Metric | Value |
|--------|-------|
| Target frame rate | 60 FPS |
| Frame budget | 16.67ms |
| Per-vehicle animation cost | ~0.1ms |
| Railway snap lookup | O(log n) |

### Memory Usage

| Component | Size |
|-----------|------|
| Preprocessed railway | ~40KB per line |
| Vehicle mesh | ~2MB per 100 vehicles |
| Animation state | ~500 bytes per vehicle |
| Trip cache | ~1KB per cached trip |

### Supported Scale

| Network | Typical Vehicles | Max Tested |
|---------|------------------|------------|
| Rodalies | 50-100 trains | 150 |
| Metro | 100-150 trains | 200 |
| Bus | 200-400 buses | 500 |
| FGC | 30-50 trains | 80 |
| Tram | 15-30 trams | 40 |

---

## Summary

The transit animation system achieves smooth 60fps visualization by:

1. **Polling** backend every 30 seconds for fresh position data
2. **Interpolating** smoothly between updates using easing functions
3. **Snapping** vehicles to track geometry for visual accuracy
4. **Predicting** positions when GPS is unavailable using schedules
5. **Simulating** deterministic positions for networks without real-time data

Each network uses the appropriate data source while sharing common animation and rendering infrastructure.
