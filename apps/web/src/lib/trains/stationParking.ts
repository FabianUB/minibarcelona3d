/**
 * Station parking system for train visualization
 *
 * When multiple trains are stopped at the same station, this module
 * calculates offset positions to prevent visual overlap. Trains are
 * positioned perpendicular to the track direction in assigned slots.
 *
 * Phase 2, Tasks T007-T012
 */

import type { PreprocessedRailwayLine } from './geometry';
import { snapTrainToRailway } from './geometry';
import type { ParkingConfig } from './networkAdapter';

/**
 * Calculated parking position for a train at a station
 */
export interface ParkingPosition {
  /**
   * Offset position as [longitude, latitude]
   * Position along the track, offset from station center
   */
  position: [number, number];

  /**
   * Bearing of the track at the station (degrees, 0-360)
   */
  trackBearing: number;

  /**
   * Bearing for the parked train (perpendicular to track, 90° offset)
   * Train should face this direction when parked
   */
  parkingBearing: number;

  /**
   * Assigned slot index (0 to maxSlots-1)
   */
  slotIndex: number;

  /**
   * Signed offset from center (-2, -1, 0, 1, 2 for 5 slots)
   */
  slotOffset: number;

  /**
   * Offset distance along the track in meters
   */
  offsetMeters: number;
}

/**
 * Default parking configuration for Rodalies network
 * Task T008
 */
export const DEFAULT_PARKING_CONFIG: ParkingConfig = {
  maxSlots: 5,
  baseSpacingMeters: 20,
  referenceZoom: 14,
  zoomScaleFactor: 0.1,
  transitionDurationMs: 500,
  groupByLine: false,
};

/**
 * Cache for parking positions
 * Key format: "stationId:trainId" → ParkingPosition
 * Task T012
 */
const parkingCache = new Map<string, ParkingPosition>();

/**
 * Cache statistics for debugging
 */
interface CacheStats {
  hits: number;
  misses: number;
  size: number;
}

let cacheStats: CacheStats = {
  hits: 0,
  misses: 0,
  size: 0,
};

/**
 * Get slot index from train ID using deterministic hashing
 *
 * Uses a simple string hash to assign trains to slots. The same train ID
 * always gets the same slot, ensuring consistent positioning across updates.
 *
 * Task T010
 *
 * @param trainId - Unique train identifier (vehicleKey)
 * @param maxSlots - Maximum number of parking slots
 * @returns Slot index (0 to maxSlots-1)
 *
 * @example
 * ```typescript
 * const slot = getSlotIndex('train_123', 5); // Returns 0-4
 * const sameSlot = getSlotIndex('train_123', 5); // Same result
 * ```
 */
export function getSlotIndex(trainId: string, maxSlots: number): number {
  let hash = 0;
  for (let i = 0; i < trainId.length; i++) {
    hash = (hash * 31 + trainId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % maxSlots;
}

/**
 * Convert slot index to signed offset from center
 *
 * For 5 slots: 0→-2, 1→-1, 2→0, 3→1, 4→2
 * This centers trains around the station position.
 *
 * @param slotIndex - Slot index (0 to maxSlots-1)
 * @param maxSlots - Maximum number of slots
 * @returns Signed offset (-half to +half)
 */
export function slotIndexToOffset(slotIndex: number, maxSlots: number): number {
  const half = Math.floor(maxSlots / 2);
  return slotIndex - half;
}

/**
 * Get the bearing of a railway line at a station
 *
 * Snaps the station coordinates to the railway line and returns the
 * bearing of the track segment at that point.
 *
 * Task T007 (part of)
 *
 * @param stationCoords - Station position as [longitude, latitude]
 * @param railwayLine - Preprocessed railway line geometry
 * @returns Bearing in degrees (0-360) or null if station not on line
 */
export function getStationTrackBearing(
  stationCoords: [number, number],
  railwayLine: PreprocessedRailwayLine
): number | null {
  const snapResult = snapTrainToRailway(stationCoords, railwayLine, 500);

  if (!snapResult) {
    return null;
  }

  return snapResult.bearing;
}

/**
 * Calculate offset position along the track direction from station center
 *
 * Given a station position, bearing, and offset distance, calculates
 * a new position along the track direction (not perpendicular).
 * This creates a gap between the station marker and the parked train.
 *
 * Task T009
 *
 * @param stationCoords - Station center position [longitude, latitude]
 * @param bearing - Track bearing in degrees (0-360, where 0 is North)
 * @param offsetMeters - Distance to offset along track (positive = forward along bearing)
 * @returns Offset position [longitude, latitude]
 *
 * @example
 * ```typescript
 * // Station at [2.173, 41.385] with track heading East (90°)
 * // Offset 20m along the track
 * const pos = calculateAlongTrackOffset([2.173, 41.385], 90, 20);
 * // Result: position ~20m east of the station
 * ```
 */
export function calculateAlongTrackOffset(
  stationCoords: [number, number],
  bearing: number,
  offsetMeters: number
): [number, number] {
  if (offsetMeters === 0) {
    return stationCoords;
  }

  const [lng, lat] = stationCoords;

  // Offset along the track bearing direction
  const bearingRad = (bearing * Math.PI) / 180;

  // Earth radius in meters
  const EARTH_RADIUS = 6_371_000;

  // Convert offset to angular distance
  const angularDistance = offsetMeters / EARTH_RADIUS;

  // Calculate latitude change (north component)
  const latChange = angularDistance * Math.cos(bearingRad);

  // Calculate longitude change (east component)
  // Adjusted for latitude (longitude degrees are smaller near poles)
  const latRad = (lat * Math.PI) / 180;
  const lngChange = (angularDistance * Math.sin(bearingRad)) / Math.cos(latRad);

  // Convert angular changes to degrees
  const newLat = lat + (latChange * 180) / Math.PI;
  const newLng = lng + (lngChange * 180) / Math.PI;

  return [newLng, newLat];
}

/**
 * Calculate zoom-adjusted spacing
 *
 * Spacing scales with zoom level to maintain appropriate visual separation
 * at different zoom levels.
 *
 * @param baseSpacing - Base spacing in meters at reference zoom
 * @param currentZoom - Current map zoom level
 * @param config - Parking configuration
 * @returns Adjusted spacing in meters
 */
export function calculateZoomAdjustedSpacing(
  baseSpacing: number,
  currentZoom: number,
  config: ParkingConfig
): number {
  const zoomDiff = currentZoom - config.referenceZoom;
  const scaleFactor = 1 + zoomDiff * config.zoomScaleFactor;
  return baseSpacing * Math.max(0.5, scaleFactor);
}

/**
 * Calculate parking position for a train at a station
 *
 * Main function for the parking system. Determines where a train should
 * be positioned when stopped at a station, with appropriate offset to
 * prevent overlap with other stopped trains.
 *
 * Task T007
 *
 * @param stationId - Station identifier
 * @param trainId - Train identifier (vehicleKey)
 * @param stationCoords - Station position [longitude, latitude]
 * @param railwayLine - Preprocessed railway line geometry
 * @param config - Parking configuration (optional, uses defaults)
 * @param currentZoom - Current map zoom level (optional, for zoom-adjusted spacing)
 * @returns Calculated parking position, or null if station not on railway
 *
 * @example
 * ```typescript
 * const parking = calculateParkingPosition(
 *   'PASSEIG_DE_GRACIA',
 *   'train_456',
 *   [2.165, 41.392],
 *   preprocessedR1Line,
 * );
 *
 * if (parking) {
 *   // Position train at parking.position with parking.bearing orientation
 * }
 * ```
 */
export function calculateParkingPosition(
  stationId: string,
  trainId: string,
  stationCoords: [number, number],
  railwayLine: PreprocessedRailwayLine,
  config: ParkingConfig = DEFAULT_PARKING_CONFIG,
  currentZoom?: number
): ParkingPosition | null {
  // Get track bearing at station
  const trackBearing = getStationTrackBearing(stationCoords, railwayLine);

  if (trackBearing === null) {
    return null;
  }

  // Calculate slot assignment
  const slotIndex = getSlotIndex(trainId, config.maxSlots);
  const slotOffset = slotIndexToOffset(slotIndex, config.maxSlots);

  // Calculate spacing (optionally zoom-adjusted)
  const spacing =
    currentZoom !== undefined
      ? calculateZoomAdjustedSpacing(config.baseSpacingMeters, currentZoom, config)
      : config.baseSpacingMeters;

  // Calculate offset along the track (creates gap from station marker)
  // Positive offset = forward along track, negative = backward
  // Add minimum offset of 30m to ensure trains don't overlap the station marker
  const MIN_STATION_OFFSET_METERS = 30;
  const slotOffsetMeters = slotOffset * spacing;
  const offsetMeters = slotOffsetMeters >= 0
    ? slotOffsetMeters + MIN_STATION_OFFSET_METERS
    : slotOffsetMeters - MIN_STATION_OFFSET_METERS;
  const position = calculateAlongTrackOffset(stationCoords, trackBearing, offsetMeters);

  // Train should be rotated perpendicular to track (90° offset)
  // This makes the train look like it's parked on a siding
  const parkingBearing = (trackBearing + 90) % 360;

  return {
    position,
    trackBearing,
    parkingBearing,
    slotIndex,
    slotOffset,
    offsetMeters,
  };
}

/**
 * Get cached parking position, or calculate and cache it
 *
 * Task T012
 *
 * @param stationId - Station identifier
 * @param trainId - Train identifier (vehicleKey)
 * @param stationCoords - Station position [longitude, latitude]
 * @param railwayLine - Preprocessed railway line geometry
 * @param config - Parking configuration
 * @param currentZoom - Current map zoom level
 * @returns Cached or newly calculated parking position
 */
export function getCachedParkingPosition(
  stationId: string,
  trainId: string,
  stationCoords: [number, number],
  railwayLine: PreprocessedRailwayLine,
  config: ParkingConfig = DEFAULT_PARKING_CONFIG,
  currentZoom?: number
): ParkingPosition | null {
  const cacheKey = `${stationId}:${trainId}`;

  // Check cache first
  const cached = parkingCache.get(cacheKey);
  if (cached) {
    cacheStats.hits++;
    return cached;
  }

  // Calculate new parking position
  cacheStats.misses++;
  const parking = calculateParkingPosition(
    stationId,
    trainId,
    stationCoords,
    railwayLine,
    config,
    currentZoom
  );

  // Cache the result if valid
  if (parking) {
    parkingCache.set(cacheKey, parking);
    cacheStats.size = parkingCache.size;
  }

  return parking;
}

/**
 * Invalidate parking cache for a specific train
 *
 * Called when a train leaves a station to clear its cached position.
 *
 * @param stationId - Station identifier
 * @param trainId - Train identifier
 */
export function invalidateParkingCache(stationId: string, trainId: string): void {
  const cacheKey = `${stationId}:${trainId}`;
  parkingCache.delete(cacheKey);
  cacheStats.size = parkingCache.size;
}

/**
 * Invalidate all parking cache entries for a train
 *
 * Called when a train's position changes significantly.
 *
 * @param trainId - Train identifier
 */
export function invalidateAllParkingCacheForTrain(trainId: string): void {
  const keysToDelete: string[] = [];
  parkingCache.forEach((_, key) => {
    if (key.endsWith(`:${trainId}`)) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach((key) => parkingCache.delete(key));
  cacheStats.size = parkingCache.size;
}

/**
 * Clear the entire parking cache
 *
 * Useful for testing or when railway data is reloaded.
 */
export function clearParkingCache(): void {
  parkingCache.clear();
  cacheStats = {
    hits: 0,
    misses: 0,
    size: 0,
  };
}

/**
 * Get cache statistics for debugging
 *
 * @returns Cache hit/miss statistics
 */
export function getParkingCacheStats(): CacheStats & { hitRate: number } {
  const total = cacheStats.hits + cacheStats.misses;
  const hitRate = total > 0 ? cacheStats.hits / total : 0;

  return {
    ...cacheStats,
    hitRate,
  };
}
