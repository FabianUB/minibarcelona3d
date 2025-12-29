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
import type { MetroLineCollection, MetroStationFeature } from '../../types/metro';
import type { RodaliesLineGeometry } from '../../types/rodalies';
import type { PreprocessedRailwayLine } from '../trains/geometry';
import { preprocessRailwayLine, sampleRailwayPosition } from '../trains/geometry';
import { loadAllBusRoutes, getAvailableBusRouteCodes, loadBusStops } from '../metro/dataLoader';
import { getBusRouteConfig, calculateBusesPerDirection } from '../../config/busConfig';

/**
 * Stop with distance along route for ordering
 */
interface StopWithDistance {
  id: string;
  name: string;
  distance: number;  // Distance along the route in meters
  coordinates: [number, number];
}

/**
 * Cache for preprocessed bus routes
 */
const preprocessedRouteCache = new Map<string, PreprocessedRailwayLine>();

/**
 * Cache for ordered stops per route
 */
const orderedStopsCache = new Map<string, StopWithDistance[]>();

/**
 * Cached route codes
 */
let cachedRouteCodes: string[] | null = null;

/**
 * Promise for loading all bus stops (to avoid duplicate fetches)
 */
let stopsLoadPromise: Promise<Map<string, MetroStationFeature>> | null = null;

/**
 * Load all bus stops into a map by ID
 */
async function getStopsMap(): Promise<Map<string, MetroStationFeature>> {
  if (!stopsLoadPromise) {
    stopsLoadPromise = (async () => {
      const stops = await loadBusStops();
      const map = new Map<string, MetroStationFeature>();
      for (const feature of stops.features) {
        map.set(feature.properties.id, feature);
      }
      return map;
    })();
  }
  return stopsLoadPromise;
}

/**
 * Get ordered stops for a bus route
 * Stops are ordered by their distance along the route geometry
 */
async function getOrderedStops(
  routeCode: string,
  route: PreprocessedRailwayLine
): Promise<StopWithDistance[]> {
  const cacheKey = routeCode.toUpperCase();

  if (orderedStopsCache.has(cacheKey)) {
    return orderedStopsCache.get(cacheKey)!;
  }

  const stopsMap = await getStopsMap();
  const routeStops: StopWithDistance[] = [];

  // Find stops that belong to this route
  for (const [id, feature] of stopsMap) {
    if (feature.properties.lines.includes(routeCode)) {
      const coords = feature.geometry.coordinates as [number, number];

      // Find closest point on route to stop
      const distance = findClosestDistanceOnRoute(coords, route);

      routeStops.push({
        id,
        name: feature.properties.name,
        distance,
        coordinates: coords,
      });
    }
  }

  // Sort by distance along route
  routeStops.sort((a, b) => a.distance - b.distance);

  orderedStopsCache.set(cacheKey, routeStops);

  return routeStops;
}

/**
 * Find the closest distance along the route to a given point
 */
function findClosestDistanceOnRoute(
  point: [number, number],
  route: PreprocessedRailwayLine
): number {
  let closestDistance = 0;
  let minDist = Infinity;

  // Check each segment
  for (const segment of route.segments) {
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
 * Find previous and next stop for a given distance along the route
 */
function findStopsBetween(
  distance: number,
  stops: StopWithDistance[],
  direction: TravelDirection
): { previousStopId: string | null; nextStopId: string | null; previousStopName: string | null; nextStopName: string | null } {
  if (stops.length === 0) {
    return { previousStopId: null, nextStopId: null, previousStopName: null, nextStopName: null };
  }

  let prevStop: StopWithDistance | null = null;
  let nextStop: StopWithDistance | null = null;

  if (direction === 0) {
    // Outbound: previous is behind, next is ahead
    for (let i = 0; i < stops.length; i++) {
      if (stops[i].distance <= distance) {
        prevStop = stops[i];
      } else {
        nextStop = stops[i];
        break;
      }
    }
    if (!nextStop && stops.length > 0) {
      nextStop = stops[0];
    }
  } else {
    // Inbound: reversed order
    for (let i = stops.length - 1; i >= 0; i--) {
      if (stops[i].distance >= distance) {
        prevStop = stops[i];
      } else {
        nextStop = stops[i];
        break;
      }
    }
    if (!nextStop && stops.length > 0) {
      nextStop = stops[stops.length - 1];
    }
  }

  return {
    previousStopId: prevStop?.id ?? null,
    nextStopId: nextStop?.id ?? null,
    previousStopName: prevStop?.name ?? null,
    nextStopName: nextStop?.name ?? null,
  };
}

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
export async function generateRoutePositions(
  routeCode: string,
  currentTimeMs: number
): Promise<VehiclePosition[]> {
  const route = preprocessedRouteCache.get(routeCode);
  if (!route) {
    return [];
  }

  // Load ordered stops for this route
  const orderedStops = await getOrderedStops(routeCode, route);

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

      // Calculate speed in meters per second
      const speedMetersPerSecond = (config.avgSpeedKmh * 1000) / 3600;

      // Find previous and next stops
      const stopInfo = findStopsBetween(finalDistance, orderedStops, direction);

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
        previousStopId: stopInfo.previousStopId,
        nextStopId: stopInfo.nextStopId,
        previousStopName: stopInfo.previousStopName,
        nextStopName: stopInfo.nextStopName,
        status: 'IN_TRANSIT_TO',
        progressFraction,
        distanceAlongLine: finalDistance,
        speedMetersPerSecond,
        lineTotalLength: route.totalLength,
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

  // Generate positions for all routes in parallel
  const routePositions = await Promise.all(
    routeCodes.map((routeCode) => generateRoutePositions(routeCode, currentTimeMs))
  );

  // Flatten into single array
  const allPositions = routePositions.flat();

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
 * Get a preprocessed bus route geometry by route code
 * Returns null if not yet loaded
 */
export function getPreprocessedBusRoute(
  routeCode: string
): PreprocessedRailwayLine | null {
  return preprocessedRouteCache.get(routeCode) ?? null;
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
