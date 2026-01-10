/**
 * Bus Position Simulator
 *
 * Generates simulated bus positions for Barcelona Bus network based on
 * schedule data (headway, average speed) rather than real-time GPS.
 *
 * Uses the unified position simulator factory with stop tracking enabled.
 */

import type { VehiclePosition } from '../../types/transit';
import type { MetroLineCollection, MetroStationFeature } from '../../types/metro';
import type { RodaliesLineGeometry } from '../../types/rodalies';
import type { PreprocessedRailwayLine } from '../trains/geometry';
import { preprocessRailwayLine } from '../trains/geometry';
import { loadAllBusRoutes, getAvailableBusRouteCodes, loadBusStops } from '../metro/dataLoader';
import { getBusRouteConfig, calculateBusesPerDirection } from '../../config/busConfig';
import { createPositionSimulator, type StopFeature } from '../transit/positionSimulatorFactory';

// ============================================================================
// Internal: Bulk Route Loading (Bus loads all routes at once)
// ============================================================================

/** Cache for preprocessed bus routes */
const preprocessedRouteCache = new Map<string, PreprocessedRailwayLine>();

/** Cached route codes */
let cachedRouteCodes: string[] | null = null;

/** Promise for bulk loading all routes */
let allRoutesPromise: Promise<void> | null = null;

/**
 * Load and preprocess all bus route geometries
 */
async function loadAndPreprocessRoutes(): Promise<void> {
  if (preprocessedRouteCache.size > 0) {
    return; // Already loaded
  }

  try {
    const routeCollection: MetroLineCollection = await loadAllBusRoutes();

    for (const feature of routeCollection.features) {
      const routeCode = feature.properties?.line_code || feature.properties?.route_id;
      if (!routeCode) continue;

      const geometry = feature.geometry as RodaliesLineGeometry;
      const preprocessed = preprocessRailwayLine(geometry);

      if (preprocessed) {
        preprocessed.lineId = routeCode;
        preprocessedRouteCache.set(routeCode, preprocessed);
      }
    }

    console.log(`[BusSimulator] Preprocessed ${preprocessedRouteCache.size} bus routes`);
  } catch (error) {
    console.error('[BusSimulator] Failed to load/preprocess bus routes:', error);
    throw error;
  }
}

/**
 * Load and preprocess a bus route geometry.
 * Uses bulk loading since Bus data comes as a single collection.
 */
async function loadPreprocessedLine(routeCode: string): Promise<PreprocessedRailwayLine | null> {
  // Ensure all routes are loaded
  if (!allRoutesPromise) {
    allRoutesPromise = loadAndPreprocessRoutes();
  }
  await allRoutesPromise;

  return preprocessedRouteCache.get(routeCode) ?? null;
}

/**
 * Get available bus route codes
 */
async function getRouteCodes(): Promise<string[]> {
  if (cachedRouteCodes) {
    return cachedRouteCodes;
  }

  cachedRouteCodes = await getAvailableBusRouteCodes();
  return cachedRouteCodes;
}

// ============================================================================
// Internal: Stop Loading (for stop tracking)
// ============================================================================

/**
 * Load all bus stops and convert to StopFeature format
 */
async function loadStopsMap(): Promise<Map<string, StopFeature>> {
  const stops = await loadBusStops();
  const map = new Map<string, StopFeature>();

  for (const feature of stops.features) {
    const stopFeature = feature as MetroStationFeature;
    map.set(stopFeature.properties.id, {
      id: stopFeature.properties.id,
      name: stopFeature.properties.name,
      coordinates: stopFeature.geometry.coordinates as [number, number],
      lines: stopFeature.properties.lines,
    });
  }

  return map;
}

// ============================================================================
// Create Simulator Instance
// ============================================================================

const busSimulator = createPositionSimulator(
  {
    networkType: 'bus',
    vehicleKeyPrefix: 'bus',
    routeIdPrefix: 'tmb-bus',
    confidence: 'low', // Bus positions are less accurate than Metro
    logPrefix: '[BusSimulator]',
  },
  {
    getLineCodes: getRouteCodes,
    getLineConfig: getBusRouteConfig,
    calculateVehiclesPerDirection: calculateBusesPerDirection,
    loadPreprocessedLine,
  },
  {
    loadStopsMap,
  }
);

// ============================================================================
// Exports (maintain backward compatibility)
// ============================================================================

/**
 * Generate simulated vehicle positions for a single bus route
 *
 * @param routeCode - The bus route code (e.g., "H6", "V15")
 * @param currentTimeMs - Current timestamp in milliseconds
 * @returns Array of simulated vehicle positions
 */
export function generateRoutePositions(
  routeCode: string,
  currentTimeMs: number
): Promise<VehiclePosition[]> {
  return busSimulator.generateLinePositions(routeCode, currentTimeMs);
}

/**
 * Generate simulated positions for all bus routes
 *
 * @param currentTimeMs - Current timestamp in milliseconds
 * @returns Array of all simulated vehicle positions
 */
export function generateAllBusPositions(currentTimeMs: number): Promise<VehiclePosition[]> {
  return busSimulator.generateAllPositions(currentTimeMs);
}

/**
 * Preload all bus route geometries for faster position generation
 *
 * Call this during app initialization to warm the cache.
 */
export function preloadBusGeometries(): Promise<void> {
  return busSimulator.preloadGeometries();
}

/**
 * Clear the preprocessed route cache
 * Useful for testing or when geometry data changes
 */
export function clearBusSimulatorCache(): void {
  busSimulator.clearCache();
  preprocessedRouteCache.clear();
  cachedRouteCodes = null;
  allRoutesPromise = null;
}

/**
 * Get a preprocessed bus route geometry by route code
 * Returns null if not yet loaded
 */
export function getPreprocessedBusRoute(routeCode: string): PreprocessedRailwayLine | null {
  return busSimulator.getPreprocessedLine(routeCode);
}

/**
 * Get statistics about simulated bus vehicles
 */
export function getBusSimulatorStats(): {
  cachedRoutes: number;
  totalExpectedVehicles: number;
} {
  const stats = busSimulator.getStats();
  return {
    cachedRoutes: stats.cachedLines,
    totalExpectedVehicles: stats.totalExpectedVehicles,
  };
}
