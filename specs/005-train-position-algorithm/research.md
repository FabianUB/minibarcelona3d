# Research: Train Position Algorithm with Station Parking

**Feature Branch**: `005-train-position-algorithm`
**Created**: 2025-12-06
**Status**: Complete

## Research Areas

### 1. Current Implementation Analysis

#### Train Position Management (`trainMeshManager.ts`)

The current implementation uses a GPS-only positioning approach with the following characteristics:

**Key Components:**
- `TrainMeshManager` class manages all train 3D meshes
- Position interpolation between polling intervals (default 30s, configurable)
- Railway line snapping via `snapTrainToRailway()` for realistic track following
- Eased interpolation using `easeInOutCubic` for smooth transitions

**Position Flow:**
1. API returns `TrainPosition` with `latitude`, `longitude`, `status`, `nextStopId`
2. Position snapped to nearest railway line segment (within 200m threshold)
3. Interpolation between `currentPosition` and `targetPosition` over polling interval
4. Railway distance-based interpolation when both positions on same line

**Existing Status Handling:**
```typescript
status: 'STOPPED_AT' | 'IN_TRANSIT_TO' | 'INCOMING_AT'
```
- `STOPPED_AT`: Train is at a station (triggers lateral offset currently)
- `IN_TRANSIT_TO`: Train moving toward next station
- `INCOMING_AT`: Train approaching station

**Current Lateral Offset (STOPPED_AT only):**
- Hash-based bucket assignment for deterministic positioning
- Sequential offset along north-south axis (fixed direction)
- Spacing: `trainLength * 3.5 + 15m` gap between trains
- Only applies when `trainStatus === 'STOPPED_AT'`

**Limitations:**
- Trains "jump" between polling intervals when not interpolating
- No schedule-aware prediction
- Stopped trains queue along fixed axis, not perpendicular to track
- No distinction between parked trains at platforms

#### Geometry Utilities (`geometry.ts`)

**Available Functions:**
- `calculateBearing(lat1, lng1, lat2, lng2)` - Haversine bearing calculation
- `interpolatePosition(start, end, t)` - Linear position interpolation
- `interpolatePositionSmooth(start, end, t)` - Eased interpolation
- `snapTrainToRailway(position, railway, maxDistance)` - Snap to nearest track segment
- `sampleRailwayPosition(railway, distance)` - Get position at distance along railway
- `preprocessRailwayLine(geometry)` - Precompute segments for efficient snapping

**`RailwaySnapResult` structure:**
```typescript
{
  position: [lng, lat],  // Snapped coordinates
  bearing: number,       // Track bearing at snap point
  distance: number,      // Distance along railway from start
  metersAway: number     // Distance from original position to snapped
}
```

### 2. Schedule/Delay Data Availability

**API Endpoints:**

1. `GET /api/trains/positions` - Lightweight polling (current)
   ```typescript
   interface TrainPosition {
     vehicleKey: string;
     latitude: number | null;
     longitude: number | null;
     nextStopId: string | null;
     routeId: string;
     status: VehicleStatus;  // STOPPED_AT, IN_TRANSIT_TO, INCOMING_AT
     polledAtUtc: string;
   }
   ```

2. `GET /api/trains/{vehicleKey}` - Full train details
   ```typescript
   interface Train {
     // ... includes:
     arrivalDelaySeconds: number | null;
     departureDelaySeconds: number | null;
     predictedArrivalUtc: string | null;
     predictedDepartureUtc: string | null;
     nextStopSequence: number | null;
   }
   ```

3. `GET /api/trips/{tripId}` - Complete trip with all stops
   ```typescript
   interface TripDetails {
     tripId: string;
     routeId: string;
     stopTimes: StopTime[];  // All stops with schedules + delays
   }

   interface StopTime {
     stopId: string;
     stopSequence: number;
     scheduledArrival: string | null;
     scheduledDeparture: string | null;
     predictedArrivalUtc: string | null;
     predictedDepartureUtc: string | null;
     arrivalDelaySeconds: number | null;
     departureDelaySeconds: number | null;
   }
   ```

**Data Availability Assessment:**
- **Delay data**: Available via `arrivalDelaySeconds`/`departureDelaySeconds`
- **Predicted times**: Available via `predictedArrivalUtc`/`predictedDepartureUtc`
- **Schedule times**: Available via `scheduledArrival`/`scheduledDeparture` in TripDetails
- **Trip context**: Available via `tripId` on Train entity

**Recommendation:**
For predictive algorithm, fetch `TripDetails` once when train enters view (cache by tripId), then use `predictedArrivalUtc` for interpolation calculations.

### 3. Station Marker Positioning

**Station Data Structure (`types/rodalies.ts`):**
```typescript
interface Station {
  id: string;
  name: string;
  code: string | null;
  lines: string[];         // Which lines serve this station
  geometry: PointGeometry; // { type: 'Point', coordinates: [lng, lat] }
}
```

**Current Station Marker System (`markerPositioning.ts`):**
- Radial offset for overlapping station markers
- Clustering by proximity (20px threshold)
- Polar coordinate distribution around cluster center

**Station-to-Railway Relationship:**
- Stations have `lines` array indicating which railway lines serve them
- Each railway line has preprocessed geometry with bearing at each segment
- Station position can be snapped to railway to get track bearing

**For Station Parking:**
1. Get station coordinates: `station.geometry.coordinates`
2. Snap station to railway line: `snapTrainToRailway(stationCoords, railway)`
3. Get perpendicular direction from `bearing` in snap result
4. Calculate parking slot positions perpendicular to track

### 4. Reference Implementation: Mini Tokyo 3D

Mini Tokyo 3D uses schedule-based positioning:
- Trains move along tracks based on departure/arrival times
- Position interpolated between stations using schedule
- Delays adjust the interpolation timing
- Stopped trains shown at platform positions

**Key Patterns to Adopt:**
- Time-based interpolation (not just distance-based)
- Station dwell time handling
- Smooth transitions on data updates

### 5. Algorithm Design

#### Predictive Position Algorithm

**Inputs:**
- `lastGpsPosition`: Most recent GPS coordinates
- `lastGpsTimestamp`: When GPS was recorded
- `currentTime`: Current animation frame time
- `predictedArrivalUtc`: Expected arrival at next station
- `nextStopId`: Station train is heading to
- `previousStopId`: Station train departed from
- `arrivalDelaySeconds`: Current delay

**Algorithm:**
```
1. If status == STOPPED_AT:
   - Use station parking algorithm
   - Return parked position

2. Calculate expected journey progress:
   - totalJourneyTime = predictedArrival - lastDeparture
   - elapsedTime = currentTime - lastDeparture
   - progress = elapsedTime / totalJourneyTime (clamped 0-1)

3. Get railway segment between stations:
   - previousStationPos = stations[previousStopId].coordinates
   - nextStationPos = stations[nextStopId].coordinates
   - railwayPath = getPathBetweenStations(previousStopId, nextStopId)

4. Sample position along railway:
   - distance = railwayPath.totalLength * progress
   - position = sampleRailwayPosition(railwayPath, distance)

5. Blend with GPS for accuracy:
   - If GPS is recent (< 30s): blend 70% predicted, 30% GPS
   - If GPS is stale (> 60s): use 100% predicted
```

#### Station Parking Algorithm

**Inputs:**
- `stationId`: Station where train is stopped
- `trainId`: For deterministic slot assignment
- `stationGeometry`: Station coordinates
- `railwayLine`: Railway geometry for bearing

**Algorithm:**
```
1. Snap station to railway:
   - snapResult = snapTrainToRailway(stationCoords, railway)
   - trackBearing = snapResult.bearing

2. Calculate perpendicular direction:
   - perpBearing = (trackBearing + 90) % 360

3. Assign parking slot:
   - slotIndex = hash(trainId) % maxSlots
   - offsetMultiplier = slotIndex - (maxSlots / 2)

4. Calculate parking position:
   - offsetDistance = offsetMultiplier * slotSpacing
   - parkX = stationLng + offsetDistance * cos(perpBearing)
   - parkY = stationLat + offsetDistance * sin(perpBearing)

5. Apply smooth transition:
   - Lerp from current position to parking position
```

## Technical Considerations

### Performance

- **Predictive calculations**: Run per-train per-frame (~100 trains * 60fps)
- **Caching required**:
  - TripDetails per tripId
  - Railway paths between station pairs
  - Parking slot assignments
- **Minimize API calls**: Only fetch TripDetails once per train

### State Management

**New State Required:**
```typescript
interface PositionAlgorithmState {
  mode: 'gps-only' | 'predictive';
  tripDetailsCache: Map<string, TripDetails>;
  parkingSlotAssignments: Map<string, Map<string, number>>; // stationId -> trainId -> slotIndex
}
```

**Storage:**
- Algorithm mode: localStorage for persistence
- Trip cache: Memory-only (cleared on refresh)
- Slot assignments: Memory-only (recalculated on load)

### Integration Points

1. **TrainMeshManager**: Add algorithm selection and parking logic
2. **MapStateProvider**: Add algorithm preference state
3. **UI Component**: Toggle button in map controls or settings
4. **Data Loader**: Add TripDetails fetching and caching

## Findings Summary

| Area | Finding | Impact |
|------|---------|--------|
| Current Implementation | GPS-only with basic interpolation | Foundation exists for enhancement |
| Schedule Data | Full schedule/delay data available via API | Enables predictive algorithm |
| Station Positioning | Station-railway relationship computable | Enables perpendicular parking |
| Performance | Per-frame calculations manageable | Need caching strategy |
| State | Simple addition to existing patterns | Low complexity integration |

## Recommended Approach

1. **Phase 1**: Implement algorithm toggle UI and state
2. **Phase 2**: Implement station parking for STOPPED_AT trains
3. **Phase 3**: Implement predictive interpolation for moving trains
4. **Phase 4**: Add TripDetails caching and blending logic
5. **Phase 5**: Testing and tuning

Total estimated tasks: 25-30 tasks across 5 phases
