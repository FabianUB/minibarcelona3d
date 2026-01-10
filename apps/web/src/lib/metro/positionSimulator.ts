/**
 * Metro Position Simulator
 *
 * Generates simulated train positions for Barcelona Metro based on
 * schedule data (headway, average speed) rather than real-time GPS.
 *
 * Uses the unified position simulator factory with stop tracking enabled.
 */

import type { VehiclePosition } from '../../types/transit';
import type { MetroLineCollection, MetroStationFeature } from '../../types/metro';
import type { RodaliesLineGeometry } from '../../types/rodalies';
import type { PreprocessedRailwayLine } from '../trains/geometry';
import { preprocessRailwayLine } from '../trains/geometry';
import { loadMetroLine, loadMetroStations, getMetroLineByCode } from './dataLoader';
import {
  METRO_LINE_CONFIG,
  getMetroLineCodes,
  calculateTrainsPerDirection,
} from '../../config/metroConfig';
import { createPositionSimulator, type StopFeature } from '../transit/positionSimulatorFactory';

// ============================================================================
// Internal: Line Loading (Metro loads individual lines)
// ============================================================================

/** Cache for preprocessed railway lines */
const preprocessedLineCache = new Map<string, PreprocessedRailwayLine>();

/**
 * Load and preprocess a metro line geometry
 */
async function loadPreprocessedLine(lineCode: string): Promise<PreprocessedRailwayLine | null> {
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
    } else {
      console.warn(`[MetroSimulator] Failed to preprocess geometry for ${lineCode}`);
    }

    return preprocessed;
  } catch (error) {
    console.error(`[MetroSimulator] Failed to load/preprocess metro line ${lineCode}:`, error);
    return null;
  }
}

// ============================================================================
// Internal: Station Loading (for stop tracking)
// ============================================================================

/**
 * Load all metro stations and convert to StopFeature format
 */
async function loadStopsMap(): Promise<Map<string, StopFeature>> {
  const stations = await loadMetroStations();
  const map = new Map<string, StopFeature>();

  for (const feature of stations.features) {
    const stationFeature = feature as MetroStationFeature;
    map.set(stationFeature.properties.id, {
      id: stationFeature.properties.id,
      name: stationFeature.properties.name,
      coordinates: stationFeature.geometry.coordinates as [number, number],
      lines: stationFeature.properties.lines,
    });
  }

  return map;
}

// ============================================================================
// Create Simulator Instance
// ============================================================================

const metroSimulator = createPositionSimulator(
  {
    networkType: 'metro',
    vehicleKeyPrefix: 'metro',
    routeIdPrefix: 'tmb-metro',
    confidence: 'medium',
    logPrefix: '[MetroSimulator]',
  },
  {
    getLineCodes: getMetroLineCodes,
    getLineConfig: (lineCode) => METRO_LINE_CONFIG[lineCode],
    calculateVehiclesPerDirection: calculateTrainsPerDirection,
    loadPreprocessedLine,
    getLineColor: (lineCode) => getMetroLineByCode(lineCode)?.color,
  },
  {
    loadStopsMap,
  }
);

// ============================================================================
// Exports (maintain backward compatibility)
// ============================================================================

/**
 * Generate simulated vehicle positions for a single metro line
 *
 * @param lineCode - The metro line code (e.g., "L1", "L3")
 * @param currentTimeMs - Current timestamp in milliseconds
 * @returns Array of simulated vehicle positions
 */
export function generateLinePositions(
  lineCode: string,
  currentTimeMs: number
): Promise<VehiclePosition[]> {
  return metroSimulator.generateLinePositions(lineCode, currentTimeMs);
}

/**
 * Generate simulated positions for all configured metro lines
 *
 * @param currentTimeMs - Current timestamp in milliseconds
 * @returns Array of all simulated vehicle positions
 */
export function generateAllMetroPositions(currentTimeMs: number): Promise<VehiclePosition[]> {
  return metroSimulator.generateAllPositions(currentTimeMs);
}

/**
 * Preload all metro line geometries for faster position generation
 *
 * Call this during app initialization to warm the cache.
 */
export function preloadMetroGeometries(): Promise<void> {
  return metroSimulator.preloadGeometries();
}

/**
 * Clear the preprocessed line cache
 * Useful for testing or when geometry data changes
 */
export function clearPositionSimulatorCache(): void {
  metroSimulator.clearCache();
  preprocessedLineCache.clear();
}

/**
 * Get a preprocessed metro line geometry by line code
 * Returns null if not yet loaded
 */
export function getPreprocessedMetroLine(lineCode: string): PreprocessedRailwayLine | null {
  return metroSimulator.getPreprocessedLine(lineCode);
}

/**
 * Get statistics about simulated metro vehicles
 */
export function getSimulatorStats(): {
  cachedLines: number;
  totalExpectedVehicles: number;
} {
  return metroSimulator.getStats();
}
