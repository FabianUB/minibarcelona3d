/**
 * FGC Position Simulator
 *
 * Generates simulated train positions for FGC (Ferrocarrils de la Generalitat)
 * based on schedule data (headway, average speed) rather than real-time GPS.
 */

import type { VehiclePosition, TravelDirection } from '../../types/transit';
import type { MetroLineCollection } from '../../types/metro';
import type { RodaliesLineGeometry } from '../../types/rodalies';
import type { PreprocessedRailwayLine } from '../trains/geometry';
import { preprocessRailwayLine, sampleRailwayPosition } from '../trains/geometry';
import { loadAllFgcLines } from '../metro/dataLoader';
import {
  FGC_LINE_CONFIG,
  getFgcLineCodes,
  calculateFgcTrainsPerDirection,
} from '../../config/fgcConfig';

/**
 * Cache for preprocessed railway lines
 */
const preprocessedLineCache = new Map<string, PreprocessedRailwayLine>();

/**
 * Cache for all FGC lines collection
 */
let allFgcLinesPromise: Promise<MetroLineCollection> | null = null;

/**
 * Load and preprocess an FGC line geometry
 */
async function getPreprocessedLine(
  lineCode: string
): Promise<PreprocessedRailwayLine | null> {
  const cacheKey = lineCode.toUpperCase();

  if (preprocessedLineCache.has(cacheKey)) {
    return preprocessedLineCache.get(cacheKey)!;
  }

  try {
    // Load all FGC lines and find the one we need
    if (!allFgcLinesPromise) {
      allFgcLinesPromise = loadAllFgcLines();
    }
    const allLines = await allFgcLinesPromise;

    // Find feature matching this line code
    const feature = allLines.features.find(
      (f) => f.properties.line_code === lineCode
    );

    if (!feature) {
      console.warn(`[FgcSimulator] No geometry found for FGC line ${lineCode}`);
      return null;
    }

    // Cast to RodaliesLineGeometry for preprocessRailwayLine compatibility
    const geometry = feature.geometry as RodaliesLineGeometry;
    const preprocessed = preprocessRailwayLine(geometry);

    if (preprocessed) {
      preprocessed.lineId = lineCode;
      preprocessedLineCache.set(cacheKey, preprocessed);
      console.log(`[FgcSimulator] Preprocessed line ${lineCode}: ${preprocessed.totalLength.toFixed(0)}m`);
    }

    return preprocessed;
  } catch (error) {
    console.error(`[FgcSimulator] Failed to load/preprocess FGC line ${lineCode}:`, error);
    return null;
  }
}

/**
 * Generate simulated vehicle positions for a single FGC line
 */
export async function generateLinePositions(
  lineCode: string,
  currentTimeMs: number
): Promise<VehiclePosition[]> {
  const config = FGC_LINE_CONFIG[lineCode];
  if (!config) {
    return [];
  }

  const railway = await getPreprocessedLine(lineCode);
  if (!railway) {
    return [];
  }

  const vehicles: VehiclePosition[] = [];

  // Calculate trains per direction
  const trainsPerDirection = calculateFgcTrainsPerDirection(
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
        vehicleKey: `fgc-${lineCode}-${direction}-${i}`,
        networkType: 'fgc',
        lineCode,
        routeId: `fgc-${lineCode}`,
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
 * Generate simulated positions for all configured FGC lines
 */
export async function generateAllFgcPositions(
  currentTimeMs: number
): Promise<VehiclePosition[]> {
  const lineCodes = getFgcLineCodes();

  const linePositions = await Promise.all(
    lineCodes.map((lineCode) => generateLinePositions(lineCode, currentTimeMs))
  );

  return linePositions.flat();
}

/**
 * Preload all FGC line geometries for faster position generation
 */
export async function preloadFgcGeometries(): Promise<void> {
  const lineCodes = getFgcLineCodes();

  await Promise.all(
    lineCodes.map((lineCode) => getPreprocessedLine(lineCode))
  );

  console.log(`Preloaded ${preprocessedLineCache.size} FGC line geometries`);
}

/**
 * Clear the preprocessed line cache
 */
export function clearFgcSimulatorCache(): void {
  preprocessedLineCache.clear();
  allFgcLinesPromise = null;
}

/**
 * Get a preprocessed FGC line geometry by line code
 * Returns null if not yet loaded
 */
export function getPreprocessedFgcLine(
  lineCode: string
): PreprocessedRailwayLine | null {
  return preprocessedLineCache.get(lineCode.toUpperCase()) ?? null;
}
