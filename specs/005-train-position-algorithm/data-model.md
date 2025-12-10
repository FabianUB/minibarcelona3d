# Data Model: Train Position Algorithm with Station Parking

**Feature Branch**: `005-train-position-algorithm`
**Created**: 2025-12-06
**Status**: Complete

## Overview

This document defines all new types, interfaces, and data structures for the train position algorithm feature. Types are organized by module and include integration notes for existing systems.

## New Types

### Algorithm Configuration

**File**: `apps/web/src/types/algorithm.ts`

```typescript
/**
 * Position algorithm mode
 * - 'gps-only': Use raw GPS coordinates with basic interpolation (current behavior)
 * - 'predictive': Use schedule-based position calculation with station parking
 */
export type PositionAlgorithmMode = 'gps-only' | 'predictive';

/**
 * Source of calculated position
 * Used for debugging and confidence scoring
 */
export type PositionSource = 'gps' | 'predicted' | 'blended' | 'parked';

/**
 * Calculated position result from any algorithm
 */
export interface CalculatedPosition {
  /** Position as [longitude, latitude] */
  position: [number, number];

  /** Track bearing in degrees (0-360, 0 = North) */
  bearing: number;

  /** How position was calculated */
  source: PositionSource;

  /** Confidence score (0-1) based on data quality */
  confidence: number;

  /** Optional debug info */
  debug?: CalculatedPositionDebug;
}

/**
 * Debug information for position calculation
 */
export interface CalculatedPositionDebug {
  /** GPS age in milliseconds */
  gpsAgeMs?: number;

  /** Schedule progress (0-1) */
  scheduleProgress?: number;

  /** Distance from GPS to predicted position (meters) */
  gpsDeviationMeters?: number;

  /** Parking slot index if parked */
  parkingSlotIndex?: number;
}
```

### Algorithm State

**File**: `apps/web/src/state/algorithm/algorithmStore.ts`

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PositionAlgorithmMode } from '../../types/algorithm';

/**
 * Algorithm state store interface
 */
export interface AlgorithmState {
  /** Current positioning algorithm mode */
  mode: PositionAlgorithmMode;

  /** Set algorithm mode */
  setMode: (mode: PositionAlgorithmMode) => void;

  /** Toggle between GPS-only and predictive modes */
  toggleMode: () => void;
}

/**
 * Zustand store for algorithm preferences
 * Persisted to localStorage
 */
export const useAlgorithmState = create<AlgorithmState>()(
  persist(
    (set) => ({
      mode: 'gps-only', // Default for backward compatibility

      setMode: (mode) => set({ mode }),

      toggleMode: () =>
        set((state) => ({
          mode: state.mode === 'gps-only' ? 'predictive' : 'gps-only',
        })),
    }),
    {
      name: 'rodalies:positionAlgorithm',
    }
  )
);
```

### Station Parking

**File**: `apps/web/src/lib/trains/stationParking.ts`

```typescript
import type { PreprocessedRailwayLine } from './geometry';

/**
 * Configuration for station parking system
 */
export interface ParkingConfig {
  /** Maximum number of parking slots per station */
  maxSlots: number;

  /** Base spacing between slots in meters */
  baseSpacingMeters: number;

  /** Zoom level for base spacing */
  baseZoom: number;

  /** Scale factor for spacing per zoom level */
  zoomScaleFactor: number;

  /** Duration for transition animations in ms */
  transitionDurationMs: number;
}

/**
 * Default parking configuration
 */
export const DEFAULT_PARKING_CONFIG: ParkingConfig = {
  maxSlots: 5,
  baseSpacingMeters: 20,
  baseZoom: 14,
  zoomScaleFactor: 0.1,
  transitionDurationMs: 500,
};

/**
 * Result of parking position calculation
 */
export interface ParkingPosition {
  /** Parking position as [longitude, latitude] */
  position: [number, number];

  /** Track bearing at station (for train orientation) */
  bearing: number;

  /** Assigned slot index (-2, -1, 0, 1, 2) */
  slotIndex: number;

  /** Perpendicular bearing (90° from track) */
  perpendicularBearing: number;

  /** Distance from station center in meters */
  offsetMeters: number;
}

/**
 * Parking slot assignment for a station
 */
export interface StationParkingSlots {
  /** Station ID */
  stationId: string;

  /** Track bearing at this station */
  trackBearing: number;

  /** Map of trainId -> slot index */
  assignments: Map<string, number>;

  /** Computed parking positions per train */
  positions: Map<string, ParkingPosition>;
}
```

### Trip Cache

**File**: `apps/web/src/lib/trains/tripCache.ts`

```typescript
import type { TripDetails } from '../../types/trains';

/**
 * Cache entry for trip details
 */
export interface TripCacheEntry {
  /** Cached trip data */
  data: TripDetails;

  /** When the entry was fetched */
  fetchedAt: number;

  /** When the entry expires */
  expiresAt: number;
}

/**
 * Cache statistics for monitoring
 */
export interface TripCacheStats {
  /** Number of cache hits */
  hits: number;

  /** Number of cache misses */
  misses: number;

  /** Current cache size */
  size: number;

  /** Hit rate (0-1) */
  hitRate: number;

  /** Total fetch time in ms */
  totalFetchTimeMs: number;

  /** Average fetch time in ms */
  avgFetchTimeMs: number;
}

/**
 * Trip cache configuration
 */
export interface TripCacheConfig {
  /** Time-to-live for cache entries in milliseconds */
  ttlMs: number;

  /** Maximum number of entries to cache */
  maxEntries: number;

  /** Whether to prefetch trips for visible trains */
  prefetchEnabled: boolean;
}

/**
 * Default trip cache configuration
 */
export const DEFAULT_TRIP_CACHE_CONFIG: TripCacheConfig = {
  ttlMs: 10 * 60 * 1000, // 10 minutes
  maxEntries: 200,
  prefetchEnabled: true,
};
```

### Predictive Calculator

**File**: `apps/web/src/lib/trains/predictiveCalculator.ts`

```typescript
import type { TrainPosition, TripDetails, StopTime } from '../../types/trains';
import type { Station } from '../../types/rodalies';
import type { PreprocessedRailwayLine } from './geometry';
import type { CalculatedPosition } from '../../types/algorithm';

/**
 * Context needed for predictive position calculation
 */
export interface PredictiveContext {
  /** Current time for progress calculation */
  currentTime: number;

  /** Cached trip details for the train */
  tripDetails: TripDetails | null;

  /** Railway line geometries by line ID */
  railwayLines: Map<string, PreprocessedRailwayLine>;

  /** Stations by station ID */
  stations: Map<string, Station>;

  /** Algorithm configuration */
  config: PredictiveConfig;
}

/**
 * Configuration for predictive algorithm
 */
export interface PredictiveConfig {
  /** GPS age threshold for blending (ms) */
  gpsBlendThresholdMs: number;

  /** GPS age threshold for fallback to GPS-only (ms) */
  gpsFallbackThresholdMs: number;

  /** Weight for predicted position in blend (0-1) */
  predictedWeight: number;

  /** Minimum progress before considering train as moving */
  minProgressThreshold: number;

  /** Maximum deviation before flagging as unreliable (meters) */
  maxDeviationMeters: number;
}

/**
 * Default predictive algorithm configuration
 */
export const DEFAULT_PREDICTIVE_CONFIG: PredictiveConfig = {
  gpsBlendThresholdMs: 30000, // 30 seconds
  gpsFallbackThresholdMs: 120000, // 2 minutes
  predictedWeight: 0.7,
  minProgressThreshold: 0.01,
  maxDeviationMeters: 100,
};

/**
 * Progress along journey between stops
 */
export interface JourneyProgress {
  /** Progress from 0 (departed) to 1 (arrived) */
  progress: number;

  /** Previous stop in journey */
  previousStop: StopTime;

  /** Next stop in journey */
  nextStop: StopTime;

  /** Time elapsed since departure (ms) */
  elapsedMs: number;

  /** Total journey duration (ms) */
  totalDurationMs: number;

  /** Whether using predicted or scheduled times */
  usingPredictedTimes: boolean;
}

/**
 * Railway path between two stations
 */
export interface StationPath {
  /** Start station ID */
  fromStationId: string;

  /** End station ID */
  toStationId: string;

  /** Preprocessed railway segment between stations */
  path: PreprocessedRailwayLine;

  /** Distance from start station to path start (meters) */
  startOffset: number;

  /** Total path length (meters) */
  totalLength: number;
}
```

### Path Finder

**File**: `apps/web/src/lib/trains/pathFinder.ts`

```typescript
import type { Station } from '../../types/rodalies';
import type { PreprocessedRailwayLine, RailwaySnapResult } from './geometry';

/**
 * Result of finding path between stations
 */
export interface PathFinderResult {
  /** Path segment between stations */
  path: PreprocessedRailwayLine;

  /** Snap result for start station */
  startSnap: RailwaySnapResult;

  /** Snap result for end station */
  endSnap: RailwaySnapResult;

  /** Distance along railway from start to end (meters) */
  distance: number;

  /** Whether path is reversed (end before start on railway) */
  isReversed: boolean;
}

/**
 * Cache key for station pair paths
 */
export type PathCacheKey = `${string}:${string}:${string}`; // fromId:toId:lineId

/**
 * Cached path between station pairs
 */
export interface CachedPath {
  result: PathFinderResult;
  computedAt: number;
}
```

## Extended Existing Types

### TrainMeshData Extension

**File**: `apps/web/src/lib/trains/trainMeshManager.ts`

```typescript
// Add to existing TrainMeshData interface
interface TrainMeshData {
  // ... existing fields ...

  /** Algorithm-specific position data */
  algorithmPosition?: {
    /** Last calculated position */
    calculatedPosition: CalculatedPosition;

    /** Position before algorithm switch (for smooth transition) */
    transitionStartPosition?: [number, number];

    /** Transition start time */
    transitionStartTime?: number;

    /** Whether currently in transition */
    isTransitioning: boolean;
  };

  /** Parking data for STOPPED_AT trains */
  parkingData?: {
    /** Station where parked */
    stationId: string;

    /** Assigned parking position */
    parkingPosition: ParkingPosition;

    /** When parking started */
    parkedAt: number;
  };
}
```

### TrainPosition Extension (API Response)

Note: No changes to API types needed. All schedule data available via existing `fetchTrainByKey` and `fetchTripDetails` endpoints.

## State Management

### Algorithm State Flow

```
User Action (Toggle)
        │
        ▼
┌───────────────────┐
│  AlgorithmStore   │ ◄── Persisted to localStorage
│  (Zustand)        │
└────────┬──────────┘
         │
         │ mode change
         ▼
┌───────────────────┐
│  TrainLayer3D     │
│  (React)          │
└────────┬──────────┘
         │
         │ pass mode to
         ▼
┌───────────────────┐
│ TrainMeshManager  │
│ (position calc)   │
└────────┬──────────┘
         │
         │ based on mode
         ▼
┌────────┴─────────┐
│                  │
▼                  ▼
GPS-Only       Predictive
Strategy       Strategy
                   │
         ┌────────┴────────┐
         │                 │
         ▼                 ▼
    StationParking   TimeInterpolation
    (STOPPED_AT)     (IN_TRANSIT_TO)
```

### Data Dependencies

```
TrainPosition (from API)
        │
        ├──► GPS-Only: Direct use
        │
        └──► Predictive:
                 │
                 ├──► tripId ──► TripDetails (cached)
                 │                    │
                 │                    └──► StopTimes with schedules/predictions
                 │
                 ├──► routeId ──► lineId ──► RailwayLine geometry
                 │
                 ├──► currentStopId ──► Station coordinates
                 │
                 └──► nextStopId ──► Station coordinates
```

## Storage

### localStorage Keys

| Key | Type | Purpose |
|-----|------|---------|
| `rodalies:positionAlgorithm` | `{ state: { mode: string } }` | Persisted algorithm preference |

### In-Memory Caches

| Cache | Size | TTL | Purpose |
|-------|------|-----|---------|
| TripCache | ~200 entries | 10 min | Trip schedule data |
| PathCache | ~100 entries | Session | Station-to-station paths |
| ParkingCache | ~50 entries | Session | Parking positions for stopped trains |

## API Data Requirements

### Existing Endpoints Used

| Endpoint | Data Needed | When Called |
|----------|-------------|-------------|
| `GET /api/trains/positions` | Position, status, nextStopId | Every 30s (existing) |
| `GET /api/trains/{key}` | tripId, delays | On train selection (existing) |
| `GET /api/trips/{tripId}` | StopTimes with schedules | On first appearance in predictive mode |

### Data Freshness

| Data Type | Refresh Rate | Cache Strategy |
|-----------|--------------|----------------|
| TrainPosition | 30s | No cache (always fresh) |
| TripDetails | 10 min TTL | In-memory cache |
| StopTime predictions | Via TripDetails | Refresh with parent |

## Network Abstraction Layer (Metro-Compatible)

### Line Resolver Interface

**File**: `apps/web/src/lib/trains/lineResolver.ts`

```typescript
import type { TrainPosition, TripDetails } from '../../types/trains';
import type { Station } from '../../types/rodalies';

/**
 * Abstraction for resolving train-to-line relationships
 * Different implementations for Rodalies (simple) vs Metro (complex)
 */
export interface LineResolver {
  /**
   * Resolve the line ID for a train
   * @returns lineId or null if cannot be determined
   */
  resolveLineId(
    train: TrainPosition,
    tripDetails?: TripDetails
  ): string | null;

  /**
   * Check if a line serves a specific station
   */
  lineServesStation(lineId: string, stationId: string): boolean;

  /**
   * Get the track bearing of a specific line at a station
   * Critical for Metro where multiple lines cross at different angles
   */
  getLineBearingAtStation(lineId: string, stationId: string): number;
}

/**
 * Simple resolver for Rodalies - direct routeId to lineId mapping
 */
export class RodaliesLineResolver implements LineResolver {
  constructor(
    private stationLineIndex: Map<string, Set<string>> // stationId -> lineIds
  ) {}

  resolveLineId(train: TrainPosition): string | null {
    // Rodalies: routeId format is "R1_ORIGIN_DEST" - extract R1
    const match = train.routeId.match(/^(R\d+)/i);
    return match ? match[1].toUpperCase() : null;
  }

  lineServesStation(lineId: string, stationId: string): boolean {
    return this.stationLineIndex.get(stationId)?.has(lineId) ?? false;
  }

  getLineBearingAtStation(lineId: string, stationId: string): number {
    // For Rodalies, we can use a simple lookup
    // Will be populated during data load
    return this.bearingCache.get(`${lineId}:${stationId}`) ?? 0;
  }

  private bearingCache = new Map<string, number>();

  setBearing(lineId: string, stationId: string, bearing: number): void {
    this.bearingCache.set(`${lineId}:${stationId}`, bearing);
  }
}

/**
 * Complex resolver for Metro - handles interchanges and multi-line stations
 * (To be implemented when Metro data is available)
 */
export class MetroLineResolver implements LineResolver {
  constructor(
    private lineStationIndex: Map<string, Set<string>>, // lineId -> stationIds
    private stationLineIndex: Map<string, Set<string>>, // stationId -> lineIds
    private tripLineMap: Map<string, string>, // tripId -> lineId
    private lineBearings: Map<string, number> // "lineId:stationId" -> bearing
  ) {}

  resolveLineId(train: TrainPosition, tripDetails?: TripDetails): string | null {
    // Strategy 1: Direct from trip mapping
    if (tripDetails && this.tripLineMap.has(tripDetails.tripId)) {
      return this.tripLineMap.get(tripDetails.tripId)!;
    }

    // Strategy 2: Infer from stations served
    if (train.nextStopId) {
      const currentStation = train.latitude && train.longitude
        ? this.findNearestStation([train.longitude, train.latitude])
        : null;

      if (currentStation) {
        return this.inferLineFromStops(currentStation, train.nextStopId);
      }
    }

    // Strategy 3: Cannot resolve
    return null;
  }

  lineServesStation(lineId: string, stationId: string): boolean {
    return this.lineStationIndex.get(lineId)?.has(stationId) ?? false;
  }

  getLineBearingAtStation(lineId: string, stationId: string): number {
    return this.lineBearings.get(`${lineId}:${stationId}`) ?? 0;
  }

  private inferLineFromStops(fromStationId: string, toStationId: string): string | null {
    const linesAtFrom = this.stationLineIndex.get(fromStationId);
    const linesAtTo = this.stationLineIndex.get(toStationId);

    if (!linesAtFrom || !linesAtTo) return null;

    // Find common lines
    for (const lineId of linesAtFrom) {
      if (linesAtTo.has(lineId)) {
        return lineId;
      }
    }

    return null;
  }

  private findNearestStation(coords: [number, number]): string | null {
    // Implementation would find nearest station to coordinates
    return null; // Placeholder
  }
}
```

### Transit Network Adapter

**File**: `apps/web/src/lib/trains/networkAdapter.ts`

```typescript
import type { PreprocessedRailwayLine } from './geometry';
import type { Station } from '../../types/rodalies';
import type { LineResolver } from './lineResolver';
import type { ParkingConfig } from './stationParking';
import type { PredictiveConfig } from './predictiveCalculator';

/**
 * Supported transit network types
 */
export type TransitNetworkType = 'rodalies' | 'metro';

/**
 * Network-specific adapter that encapsulates all transit system differences
 */
export interface TransitNetworkAdapter {
  /** Network type identifier */
  networkType: TransitNetworkType;

  /** Line resolution strategy */
  lineResolver: LineResolver;

  /** Railway line geometries by line ID */
  railwayLines: Map<string, PreprocessedRailwayLine>;

  /** Stations by station ID */
  stations: Map<string, Station>;

  /** Parking configuration for this network */
  parkingConfig: ParkingConfig;

  /** Predictive algorithm configuration */
  predictiveConfig: PredictiveConfig;
}

/**
 * Extended parking config for Metro with line grouping
 */
export interface MetroParkingConfig extends ParkingConfig {
  /** Group trains by line at interchanges */
  useLineGrouping: boolean;

  /** Angular spacing between line sectors (degrees) */
  lineSectorSpacing: number;

  /** Max trains per line sector before overflow */
  maxTrainsPerLineSector: number;
}

/**
 * Create adapter for Rodalies network
 */
export function createRodaliesAdapter(
  railwayLines: Map<string, PreprocessedRailwayLine>,
  stations: Map<string, Station>
): TransitNetworkAdapter {
  // Build station-line index from station data
  const stationLineIndex = new Map<string, Set<string>>();
  for (const station of stations.values()) {
    stationLineIndex.set(station.id, new Set(station.lines));
  }

  return {
    networkType: 'rodalies',
    lineResolver: new RodaliesLineResolver(stationLineIndex),
    railwayLines,
    stations,
    parkingConfig: DEFAULT_PARKING_CONFIG,
    predictiveConfig: DEFAULT_PREDICTIVE_CONFIG,
  };
}

/**
 * Create adapter for Metro network (future)
 */
export function createMetroAdapter(
  railwayLines: Map<string, PreprocessedRailwayLine>,
  stations: Map<string, Station>,
  tripLineMap: Map<string, string>,
  lineBearings: Map<string, number>
): TransitNetworkAdapter {
  // Build indices
  const lineStationIndex = new Map<string, Set<string>>();
  const stationLineIndex = new Map<string, Set<string>>();

  for (const station of stations.values()) {
    stationLineIndex.set(station.id, new Set(station.lines));
    for (const lineId of station.lines) {
      if (!lineStationIndex.has(lineId)) {
        lineStationIndex.set(lineId, new Set());
      }
      lineStationIndex.get(lineId)!.add(station.id);
    }
  }

  const metroParkingConfig: MetroParkingConfig = {
    ...DEFAULT_PARKING_CONFIG,
    maxSlots: 8, // More slots for busy Metro stations
    useLineGrouping: true,
    lineSectorSpacing: 45, // 8 sectors of 45° each
    maxTrainsPerLineSector: 3,
  };

  return {
    networkType: 'metro',
    lineResolver: new MetroLineResolver(
      lineStationIndex,
      stationLineIndex,
      tripLineMap,
      lineBearings
    ),
    railwayLines,
    stations,
    parkingConfig: metroParkingConfig,
    predictiveConfig: DEFAULT_PREDICTIVE_CONFIG,
  };
}
```

### Updated Parking Position (Line-Aware)

**File**: `apps/web/src/lib/trains/stationParking.ts` (additions)

```typescript
/**
 * Extended parking position with line context
 */
export interface ParkingPositionWithLine extends ParkingPosition {
  /** Line ID this parking position is associated with */
  lineId: string;

  /** Sector index for Metro line grouping (0-7 for 8 sectors) */
  lineSectorIndex?: number;
}

/**
 * Calculate parking position with explicit line context
 * Works for both Rodalies (simple) and Metro (line-grouped)
 */
export function calculateParkingPositionForLine(
  stationId: string,
  trainId: string,
  lineId: string,
  stationCoords: [number, number],
  adapter: TransitNetworkAdapter
): ParkingPositionWithLine {
  // Get bearing for THIS specific line at this station
  const trackBearing = adapter.lineResolver.getLineBearingAtStation(lineId, stationId);
  const perpBearingRad = ((trackBearing + 90) % 360) * Math.PI / 180;

  const config = adapter.parkingConfig;

  // Metro: use line-grouped sectors
  if ('useLineGrouping' in config && config.useLineGrouping) {
    const metroConfig = config as MetroParkingConfig;
    const lineSectorIndex = hashLineToSector(lineId, 360 / metroConfig.lineSectorSpacing);
    const sectorBearingRad = (lineSectorIndex * metroConfig.lineSectorSpacing) * Math.PI / 180;

    // Slot within the line's sector
    const slotInSector = getSlotIndex(trainId, metroConfig.maxTrainsPerLineSector);
    const offsetDistance = slotInSector * config.baseSpacingMeters;

    return {
      position: offsetCoordinates(stationCoords, sectorBearingRad, offsetDistance),
      bearing: trackBearing,
      slotIndex: slotInSector,
      perpendicularBearing: sectorBearingRad * 180 / Math.PI,
      offsetMeters: offsetDistance,
      lineId,
      lineSectorIndex,
    };
  }

  // Rodalies: simple perpendicular offset
  const slotIndex = getSlotIndex(trainId, config.maxSlots);
  const offsetIndex = slotIndex - Math.floor(config.maxSlots / 2);
  const offsetDistance = offsetIndex * config.baseSpacingMeters;

  return {
    position: offsetCoordinates(stationCoords, perpBearingRad, offsetDistance),
    bearing: trackBearing,
    slotIndex,
    perpendicularBearing: (trackBearing + 90) % 360,
    offsetMeters: offsetDistance,
    lineId,
  };
}

function hashLineToSector(lineId: string, numSectors: number): number {
  let hash = 0;
  for (let i = 0; i < lineId.length; i++) {
    hash = (hash * 31 + lineId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % numSectors;
}

function offsetCoordinates(
  coords: [number, number],
  bearingRad: number,
  distanceMeters: number
): [number, number] {
  const METERS_PER_DEGREE_LAT = 111320;
  const METERS_PER_DEGREE_LNG = METERS_PER_DEGREE_LAT * Math.cos(coords[1] * Math.PI / 180);

  return [
    coords[0] + (distanceMeters / METERS_PER_DEGREE_LNG) * Math.sin(bearingRad),
    coords[1] + (distanceMeters / METERS_PER_DEGREE_LAT) * Math.cos(bearingRad),
  ];
}
```

## Type Exports

**File**: `apps/web/src/types/index.ts`

```typescript
// Add to existing exports
export type {
  PositionAlgorithmMode,
  PositionSource,
  CalculatedPosition,
  CalculatedPositionDebug,
} from './algorithm';
```

**File**: `apps/web/src/lib/trains/index.ts`

```typescript
// Add new exports
export { calculateParkingPosition, getStationTrackBearing } from './stationParking';
export type { ParkingConfig, ParkingPosition, StationParkingSlots } from './stationParking';

export { TripCache } from './tripCache';
export type { TripCacheEntry, TripCacheStats, TripCacheConfig } from './tripCache';

export { calculatePredictivePosition } from './predictiveCalculator';
export type { PredictiveContext, PredictiveConfig, JourneyProgress, StationPath } from './predictiveCalculator';

export { getPathBetweenStations } from './pathFinder';
export type { PathFinderResult, CachedPath } from './pathFinder';
```
