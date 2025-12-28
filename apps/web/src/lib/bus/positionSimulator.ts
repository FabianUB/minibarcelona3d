/**
 * Bus Position Simulator
 *
 * Generates simulated bus positions for Barcelona Bus network based on
 * schedule data (headway, average speed) rather than real-time GPS.
 *
 * Algorithm is similar to Metro position simulator:
 * 1. Calculate number of buses needed for each direction based on headway
 * 2. Space buses evenly along the route
 * 3. Offset all positions based on current time within headway cycle
 * 4. Sample positions from route geometry
 */

import type { VehiclePosition, TravelDirection } from '../../types/transit';
import type { MetroLineCollection } from '../../types/metro';
import type { RodaliesLineGeometry } from '../../types/rodalies';
import type { PreprocessedRailwayLine } from '../trains/geometry';
import { preprocessRailwayLine, sampleRailwayPosition } from '../trains/geometry';
import { loadAllBusRoutes, getAvailableBusRouteCodes } from '../metro/dataLoader';
import { getBusRouteConfig, calculateBusesPerDirection } from '../../config/busConfig';

/**
 * Cache for preprocessed bus routes
 */
const preprocessedRouteCache = new Map<string, PreprocessedRailwayLine>();

/**
 * Cached route codes
 */
let cachedRouteCodes: string[] | null = null;

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
      const routeCode = feature.properties?.route_code || feature.properties?.line_code;
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
 * Get available bus route codes
 */
async function getRouteCodes(): Promise<string[]> {
  if (cachedRouteCodes) {
    return cachedRouteCodes;
  }

  cachedRouteCodes = await getAvailableBusRouteCodes();
  return cachedRouteCodes;
}

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
): VehiclePosition[] {
  const route = preprocessedRouteCache.get(routeCode);
  if (!route) {
    return [];
  }

  const config = getBusRouteConfig(routeCode);
  const vehicles: VehiclePosition[] = [];

  // Calculate buses per direction
  const busesPerDirection = calculateBusesPerDirection(route.totalLength, routeCode);

  if (busesPerDirection === 0) {
    return [];
  }

  // Calculate spacing and time offset
  const spacing = route.totalLength / busesPerDirection;
  const headwayMs = config.headwaySeconds * 1000;
  const timeOffset = (currentTimeMs % headwayMs) / headwayMs;

  // Generate positions for both directions
  for (const direction of [0, 1] as TravelDirection[]) {
    for (let i = 0; i < busesPerDirection; i++) {
      // Base distance along route
      const baseDistance = i * spacing;

      // Apply time-based offset for movement
      const adjustedDistance =
        (baseDistance + timeOffset * spacing) % route.totalLength;

      // For return direction (1), measure from the other end
      const finalDistance =
        direction === 0
          ? adjustedDistance
          : route.totalLength - adjustedDistance;

      // Sample position and bearing from geometry
      const { position, bearing } = sampleRailwayPosition(route, finalDistance);

      // Adjust bearing for return direction
      const finalBearing = direction === 1 ? (bearing + 180) % 360 : bearing;

      // Calculate progress as fraction of route length
      const progressFraction = finalDistance / route.totalLength;

      vehicles.push({
        vehicleKey: `bus-${routeCode}-${direction}-${i}`,
        networkType: 'bus',
        lineCode: routeCode,
        routeId: `tmb-bus-${routeCode}`,
        latitude: position[1],
        longitude: position[0],
        bearing: finalBearing,
        source: 'schedule',
        confidence: 'low', // Bus positions are less accurate than Metro
        estimatedAt: currentTimeMs,
        direction,
        previousStopId: null,
        nextStopId: null,
        status: 'IN_TRANSIT_TO',
        progressFraction,
        distanceAlongLine: finalDistance,
        lineColor: config.color,
      });
    }
  }

  return vehicles;
}

/**
 * Generate simulated positions for all bus routes
 *
 * @param currentTimeMs - Current timestamp in milliseconds
 * @returns Array of all simulated vehicle positions
 */
export async function generateAllBusPositions(
  currentTimeMs: number
): Promise<VehiclePosition[]> {
  // Ensure routes are loaded
  await loadAndPreprocessRoutes();

  const routeCodes = await getRouteCodes();
  const allPositions: VehiclePosition[] = [];

  // Generate positions for all routes
  for (const routeCode of routeCodes) {
    const positions = generateRoutePositions(routeCode, currentTimeMs);
    allPositions.push(...positions);
  }

  if (allPositions.length > 0) {
    console.log(`[BusSimulator] Generated ${allPositions.length} vehicle positions`);
  }

  return allPositions;
}

/**
 * Preload all bus route geometries for faster position generation
 *
 * Call this during app initialization to warm the cache.
 */
export async function preloadBusGeometries(): Promise<void> {
  await loadAndPreprocessRoutes();
  console.log(`Preloaded ${preprocessedRouteCache.size} bus route geometries`);
}

/**
 * Clear the preprocessed route cache
 * Useful for testing or when geometry data changes
 */
export function clearBusSimulatorCache(): void {
  preprocessedRouteCache.clear();
  cachedRouteCodes = null;
}

/**
 * Get statistics about simulated bus vehicles
 */
export function getBusSimulatorStats(): {
  cachedRoutes: number;
  totalExpectedVehicles: number;
} {
  let totalExpectedVehicles = 0;

  for (const [routeCode, route] of preprocessedRouteCache) {
    const busesPerDir = calculateBusesPerDirection(route.totalLength, routeCode);
    totalExpectedVehicles += busesPerDir * 2; // Both directions
  }

  return {
    cachedRoutes: preprocessedRouteCache.size,
    totalExpectedVehicles,
  };
}
