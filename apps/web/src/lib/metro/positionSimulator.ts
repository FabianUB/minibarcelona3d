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
import type { MetroLineCollection } from '../../types/metro';
import type { RodaliesLineGeometry } from '../../types/rodalies';
import type { PreprocessedRailwayLine } from '../trains/geometry';
import { preprocessRailwayLine, sampleRailwayPosition } from '../trains/geometry';
import { loadMetroLine, getMetroLineByCode } from './dataLoader';
import {
  METRO_LINE_CONFIG,
  getMetroLineCodes,
  calculateTrainsPerDirection,
} from '../../config/metroConfig';

/**
 * Cache for preprocessed railway lines
 */
const preprocessedLineCache = new Map<string, PreprocessedRailwayLine>();

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
        previousStopId: null,
        nextStopId: null,
        status: 'IN_TRANSIT_TO',
        progressFraction,
        distanceAlongLine: finalDistance,
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
  const allPositions = linePositions.flat();

  if (allPositions.length > 0) {
    console.log(`[MetroSimulator] Generated ${allPositions.length} vehicle positions`);
  }

  return allPositions;
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
