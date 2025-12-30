/**
 * TRAM Position Simulator
 *
 * Generates simulated tram positions for Barcelona TRAM based on
 * schedule data (headway, average speed) rather than real-time GPS.
 */

import type { VehiclePosition, TravelDirection } from '../../types/transit';
import type { MetroLineCollection } from '../../types/metro';
import type { RodaliesLineGeometry } from '../../types/rodalies';
import type { PreprocessedRailwayLine } from '../trains/geometry';
import { preprocessRailwayLine, sampleRailwayPosition } from '../trains/geometry';
import { loadAllTramLines } from '../metro/dataLoader';
import {
  TRAM_LINE_CONFIG,
  getTramLineCodes,
  calculateTramsPerDirection,
} from '../../config/tramConfig';

/**
 * Cache for preprocessed railway lines
 */
const preprocessedLineCache = new Map<string, PreprocessedRailwayLine>();

/**
 * Cache for all tram lines collection
 */
let allTramLinesPromise: Promise<MetroLineCollection> | null = null;

/**
 * Load and preprocess a tram line geometry
 */
async function getPreprocessedLine(
  lineCode: string
): Promise<PreprocessedRailwayLine | null> {
  const cacheKey = lineCode.toUpperCase();

  if (preprocessedLineCache.has(cacheKey)) {
    return preprocessedLineCache.get(cacheKey)!;
  }

  try {
    // Load all tram lines and find the one we need
    if (!allTramLinesPromise) {
      allTramLinesPromise = loadAllTramLines();
    }
    const allLines = await allTramLinesPromise;

    // Find feature matching this line code
    const feature = allLines.features.find(
      (f) => f.properties.line_code === lineCode
    );

    if (!feature) {
      console.warn(`[TramSimulator] No geometry found for tram line ${lineCode}`);
      return null;
    }

    // Cast to RodaliesLineGeometry for preprocessRailwayLine compatibility
    const geometry = feature.geometry as RodaliesLineGeometry;
    const preprocessed = preprocessRailwayLine(geometry);

    if (preprocessed) {
      preprocessed.lineId = lineCode;
      preprocessedLineCache.set(cacheKey, preprocessed);
      console.log(`[TramSimulator] Preprocessed line ${lineCode}: ${preprocessed.totalLength.toFixed(0)}m`);
    }

    return preprocessed;
  } catch (error) {
    console.error(`[TramSimulator] Failed to load/preprocess tram line ${lineCode}:`, error);
    return null;
  }
}

/**
 * Generate simulated vehicle positions for a single tram line
 */
export async function generateLinePositions(
  lineCode: string,
  currentTimeMs: number
): Promise<VehiclePosition[]> {
  const config = TRAM_LINE_CONFIG[lineCode];
  if (!config) {
    return [];
  }

  const railway = await getPreprocessedLine(lineCode);
  if (!railway) {
    return [];
  }

  const vehicles: VehiclePosition[] = [];

  // Calculate trams per direction
  const tramsPerDirection = calculateTramsPerDirection(
    railway.totalLength,
    lineCode
  );

  if (tramsPerDirection === 0) {
    return [];
  }

  // Calculate spacing and time offset
  const spacing = railway.totalLength / tramsPerDirection;
  const headwayMs = config.headwaySeconds * 1000;
  const timeOffset = (currentTimeMs % headwayMs) / headwayMs;

  // Calculate speed in meters per second
  const speedMetersPerSecond = (config.avgSpeedKmh * 1000) / 3600;

  // Generate positions for both directions
  for (const direction of [0, 1] as TravelDirection[]) {
    for (let i = 0; i < tramsPerDirection; i++) {
      const baseDistance = i * spacing;
      const adjustedDistance =
        (baseDistance + timeOffset * spacing) % railway.totalLength;

      const finalDistance =
        direction === 0
          ? adjustedDistance
          : railway.totalLength - adjustedDistance;

      const { position, bearing } = sampleRailwayPosition(railway, finalDistance);
      const finalBearing = direction === 1 ? (bearing + 180) % 360 : bearing;
      const progressFraction = finalDistance / railway.totalLength;

      vehicles.push({
        vehicleKey: `tram-${lineCode}-${direction}-${i}`,
        networkType: 'tram',
        lineCode,
        routeId: `tram-${lineCode}`,
        latitude: position[1],
        longitude: position[0],
        bearing: finalBearing,
        source: 'schedule',
        confidence: 'medium',
        estimatedAt: currentTimeMs,
        direction,
        previousStopId: null,
        nextStopId: null,
        previousStopName: null,
        nextStopName: null,
        status: 'IN_TRANSIT_TO',
        progressFraction,
        distanceAlongLine: finalDistance,
        speedMetersPerSecond,
        lineTotalLength: railway.totalLength,
        lineColor: config.color,
      });
    }
  }

  return vehicles;
}

/**
 * Generate simulated positions for all configured tram lines
 */
export async function generateAllTramPositions(
  currentTimeMs: number
): Promise<VehiclePosition[]> {
  const lineCodes = getTramLineCodes();

  const linePositions = await Promise.all(
    lineCodes.map((lineCode) => generateLinePositions(lineCode, currentTimeMs))
  );

  return linePositions.flat();
}

/**
 * Preload all tram line geometries for faster position generation
 */
export async function preloadTramGeometries(): Promise<void> {
  const lineCodes = getTramLineCodes();

  await Promise.all(
    lineCodes.map((lineCode) => getPreprocessedLine(lineCode))
  );

  console.log(`Preloaded ${preprocessedLineCache.size} tram line geometries`);
}

/**
 * Clear the preprocessed line cache
 */
export function clearTramSimulatorCache(): void {
  preprocessedLineCache.clear();
  allTramLinesPromise = null;
}
