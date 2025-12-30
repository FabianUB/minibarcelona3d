/**
 * Metro Position Simulator
 *
 * Generates simulated train positions for Barcelona Metro based on
 * schedule data (headway, average speed) rather than real-time GPS.
 *
 * Algorithm:
 * 1. Calculate number of trains needed for each direction based on headway
 * 2. Space trains evenly along the line
 * 3. Offset all positions based on current time within headway cycle
 * 4. Sample positions from line geometry
 */

import type { VehiclePosition, TravelDirection } from '../../types/transit';
import type { MetroLineCollection, MetroStationFeature } from '../../types/metro';
import type { RodaliesLineGeometry } from '../../types/rodalies';
import type { PreprocessedRailwayLine } from '../trains/geometry';
import { preprocessRailwayLine, sampleRailwayPosition } from '../trains/geometry';
import { loadMetroLine, loadMetroStations, getMetroLineByCode } from './dataLoader';
import {
  METRO_LINE_CONFIG,
  getMetroLineCodes,
  calculateTrainsPerDirection,
} from '../../config/metroConfig';

/**
 * Station with distance along line for ordering
 */
interface StationWithDistance {
  id: string;
  name: string;
  distance: number;  // Distance along the line in meters
  coordinates: [number, number];
}

/**
 * Cache for preprocessed railway lines
 */
const preprocessedLineCache = new Map<string, PreprocessedRailwayLine>();

/**
 * Cache for ordered stations per line
 */
const orderedStationsCache = new Map<string, StationWithDistance[]>();

/**
 * Promise for loading all metro stations (to avoid duplicate fetches)
 */
let stationsLoadPromise: Promise<Map<string, MetroStationFeature>> | null = null;

/**
 * Load all metro stations into a map by ID
 */
async function getStationsMap(): Promise<Map<string, MetroStationFeature>> {
  if (!stationsLoadPromise) {
    stationsLoadPromise = (async () => {
      const stations = await loadMetroStations();
      const map = new Map<string, MetroStationFeature>();
      for (const feature of stations.features) {
        map.set(feature.properties.id, feature);
      }
      return map;
    })();
  }
  return stationsLoadPromise;
}

/**
 * Get ordered stations for a metro line
 * Stations are ordered by their distance along the line geometry
 */
async function getOrderedStations(
  lineCode: string,
  railway: PreprocessedRailwayLine
): Promise<StationWithDistance[]> {
  const cacheKey = lineCode.toUpperCase();

  if (orderedStationsCache.has(cacheKey)) {
    return orderedStationsCache.get(cacheKey)!;
  }

  const stationsMap = await getStationsMap();
  const lineStations: StationWithDistance[] = [];

  // Find stations that belong to this line
  for (const [id, feature] of stationsMap) {
    if (feature.properties.lines.includes(lineCode)) {
      const coords = feature.geometry.coordinates as [number, number];

      // Find closest point on line to station
      const distance = findClosestDistanceOnLine(coords, railway);

      lineStations.push({
        id,
        name: feature.properties.name,
        distance,
        coordinates: coords,
      });
    }
  }

  // Sort by distance along line
  lineStations.sort((a, b) => a.distance - b.distance);

  orderedStationsCache.set(cacheKey, lineStations);
  console.log(`[MetroSimulator] Ordered ${lineStations.length} stations for line ${lineCode}`);

  return lineStations;
}

/**
 * Find the closest distance along the railway line to a given point
 */
function findClosestDistanceOnLine(
  point: [number, number],
  railway: PreprocessedRailwayLine
): number {
  let closestDistance = 0;
  let minDist = Infinity;

  // Check each segment
  for (const segment of railway.segments) {
    const [x1, y1] = segment.start;
    const [x2, y2] = segment.end;
    const [px, py] = point;

    // Segment length is the difference between end and start distances
    const segmentLength = segment.endDistance - segment.startDistance;

    // Project point onto segment
    const dx = x2 - x1;
    const dy = y2 - y1;
    const segmentLengthSq = dx * dx + dy * dy;

    let t = 0;
    if (segmentLengthSq > 0) {
      t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / segmentLengthSq));
    }

    const projX = x1 + t * dx;
    const projY = y1 + t * dy;

    const dist = Math.hypot(px - projX, py - projY);

    if (dist < minDist) {
      minDist = dist;
      closestDistance = segment.startDistance + t * segmentLength;
    }
  }

  return closestDistance;
}

/**
 * Find previous and next station for a given distance along the line
 */
function findStationsBetween(
  distance: number,
  stations: StationWithDistance[],
  direction: TravelDirection
): { previousStopId: string | null; nextStopId: string | null; previousStopName: string | null; nextStopName: string | null } {
  if (stations.length === 0) {
    return { previousStopId: null, nextStopId: null, previousStopName: null, nextStopName: null };
  }

  // For direction 0 (outbound): increasing distance
  // For direction 1 (inbound): decreasing distance
  let prevStation: StationWithDistance | null = null;
  let nextStation: StationWithDistance | null = null;

  if (direction === 0) {
    // Outbound: previous is behind, next is ahead
    for (let i = 0; i < stations.length; i++) {
      if (stations[i].distance <= distance) {
        prevStation = stations[i];
      } else {
        nextStation = stations[i];
        break;
      }
    }
    // If no next station, wrap to first
    if (!nextStation && stations.length > 0) {
      nextStation = stations[0];
    }
  } else {
    // Inbound: reversed order
    for (let i = stations.length - 1; i >= 0; i--) {
      if (stations[i].distance >= distance) {
        prevStation = stations[i];
      } else {
        nextStation = stations[i];
        break;
      }
    }
    // If no next station, wrap to last
    if (!nextStation && stations.length > 0) {
      nextStation = stations[stations.length - 1];
    }
  }

  return {
    previousStopId: prevStation?.id ?? null,
    nextStopId: nextStation?.id ?? null,
    previousStopName: prevStation?.name ?? null,
    nextStopName: nextStation?.name ?? null,
  };
}

/**
 * Load and preprocess a metro line geometry
 */
async function getPreprocessedLine(
  lineCode: string
): Promise<PreprocessedRailwayLine | null> {
  const cacheKey = lineCode.toUpperCase();

  if (preprocessedLineCache.has(cacheKey)) {
    return preprocessedLineCache.get(cacheKey)!;
  }

  try {
    const lineCollection: MetroLineCollection = await loadMetroLine(lineCode);
    if (!lineCollection.features.length) {
      console.warn(`[MetroSimulator] No features found for metro line ${lineCode}`);
      return null;
    }

    // Metro lines typically have a single LineString feature
    const feature = lineCollection.features[0];

    // Cast to RodaliesLineGeometry for preprocessRailwayLine compatibility
    const geometry = feature.geometry as RodaliesLineGeometry;
    const preprocessed = preprocessRailwayLine(geometry);

    if (preprocessed) {
      preprocessed.lineId = lineCode;
      preprocessedLineCache.set(cacheKey, preprocessed);
      console.log(`[MetroSimulator] Preprocessed line ${lineCode}: ${preprocessed.totalLength.toFixed(0)}m, ${preprocessed.segments.length} segments`);
    } else {
      console.warn(`[MetroSimulator] Failed to preprocess geometry for ${lineCode}`);
    }

    return preprocessed;
  } catch (error) {
    console.error(`[MetroSimulator] Failed to load/preprocess metro line ${lineCode}:`, error);
    return null;
  }
}

/**
 * Generate simulated vehicle positions for a single metro line
 *
 * @param lineCode - The metro line code (e.g., "L1", "L3")
 * @param currentTimeMs - Current timestamp in milliseconds
 * @returns Array of simulated vehicle positions
 */
export async function generateLinePositions(
  lineCode: string,
  currentTimeMs: number
): Promise<VehiclePosition[]> {
  const config = METRO_LINE_CONFIG[lineCode];
  if (!config) {
    console.warn(`No configuration for metro line ${lineCode}`);
    return [];
  }

  const railway = await getPreprocessedLine(lineCode);
  if (!railway) {
    return [];
  }

  // Load ordered stations for this line
  const orderedStations = await getOrderedStations(lineCode, railway);

  const lineInfo = getMetroLineByCode(lineCode);
  const lineColor = lineInfo?.color ?? config.color;

  const vehicles: VehiclePosition[] = [];

  // Calculate trains per direction
  const trainsPerDirection = calculateTrainsPerDirection(
    railway.totalLength,
    lineCode
  );

  if (trainsPerDirection === 0) {
    return [];
  }

  // Calculate spacing and time offset
  const spacing = railway.totalLength / trainsPerDirection;
  const headwayMs = config.headwaySeconds * 1000;
  const timeOffset = (currentTimeMs % headwayMs) / headwayMs;

  // Calculate speed in meters per second
  const speedMetersPerSecond = (config.avgSpeedKmh * 1000) / 3600;

  // Generate positions for both directions
  for (const direction of [0, 1] as TravelDirection[]) {
    for (let i = 0; i < trainsPerDirection; i++) {
      // Base distance along line
      const baseDistance = i * spacing;

      // Apply time-based offset for movement
      // Offset increases over time, creating forward motion
      const adjustedDistance =
        (baseDistance + timeOffset * spacing) % railway.totalLength;

      // For return direction (1), measure from the other end
      const finalDistance =
        direction === 0
          ? adjustedDistance
          : railway.totalLength - adjustedDistance;

      // Sample position and bearing from geometry
      const { position, bearing } = sampleRailwayPosition(railway, finalDistance);

      // Adjust bearing for return direction
      const finalBearing = direction === 1 ? (bearing + 180) % 360 : bearing;

      // Calculate progress as fraction of line length
      const progressFraction = finalDistance / railway.totalLength;

      // Find previous and next stations
      const stationInfo = findStationsBetween(finalDistance, orderedStations, direction);

      vehicles.push({
        vehicleKey: `metro-${lineCode}-${direction}-${i}`,
        networkType: 'metro',
        lineCode,
        routeId: `tmb-metro-${lineCode}`,
        latitude: position[1],
        longitude: position[0],
        bearing: finalBearing,
        source: 'schedule',
        confidence: 'medium',
        estimatedAt: currentTimeMs,
        direction,
        previousStopId: stationInfo.previousStopId,
        nextStopId: stationInfo.nextStopId,
        previousStopName: stationInfo.previousStopName,
        nextStopName: stationInfo.nextStopName,
        status: 'IN_TRANSIT_TO',
        progressFraction,
        distanceAlongLine: finalDistance,
        speedMetersPerSecond,
        lineTotalLength: railway.totalLength,
        lineColor,
      });
    }
  }

  return vehicles;
}

/**
 * Generate simulated positions for all configured metro lines
 *
 * @param currentTimeMs - Current timestamp in milliseconds
 * @returns Array of all simulated vehicle positions
 */
export async function generateAllMetroPositions(
  currentTimeMs: number
): Promise<VehiclePosition[]> {
  const lineCodes = getMetroLineCodes();

  // Generate positions for all lines in parallel
  const linePositions = await Promise.all(
    lineCodes.map((lineCode) => generateLinePositions(lineCode, currentTimeMs))
  );

  // Flatten into single array
  return linePositions.flat();
}

/**
 * Preload all metro line geometries for faster position generation
 *
 * Call this during app initialization to warm the cache.
 */
export async function preloadMetroGeometries(): Promise<void> {
  const lineCodes = getMetroLineCodes();

  await Promise.all(
    lineCodes.map((lineCode) => getPreprocessedLine(lineCode))
  );

  console.log(`Preloaded ${preprocessedLineCache.size} metro line geometries`);
}

/**
 * Clear the preprocessed line cache
 * Useful for testing or when geometry data changes
 */
export function clearPositionSimulatorCache(): void {
  preprocessedLineCache.clear();
}

/**
 * Get a preprocessed metro line geometry by line code
 * Returns null if not yet loaded
 */
export function getPreprocessedMetroLine(
  lineCode: string
): PreprocessedRailwayLine | null {
  return preprocessedLineCache.get(lineCode.toUpperCase()) ?? null;
}

/**
 * Get statistics about simulated metro vehicles
 */
export function getSimulatorStats(): {
  cachedLines: number;
  totalExpectedVehicles: number;
} {
  let totalExpectedVehicles = 0;

  for (const lineCode of getMetroLineCodes()) {
    const railway = preprocessedLineCache.get(lineCode.toUpperCase());
    if (railway) {
      const trainsPerDir = calculateTrainsPerDirection(railway.totalLength, lineCode);
      totalExpectedVehicles += trainsPerDir * 2; // Both directions
    }
  }

  return {
    cachedLines: preprocessedLineCache.size,
    totalExpectedVehicles,
  };
}
