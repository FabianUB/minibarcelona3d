/**
 * Position Simulator Factory
 *
 * Creates position simulators for any transit network (Metro, Bus, Tram, FGC).
 * Unifies the common algorithm:
 * 1. Calculate number of vehicles per direction based on headway
 * 2. Space vehicles evenly along the line/route
 * 3. Offset all positions based on current time within headway cycle
 * 4. Sample positions from line geometry
 *
 * This factory eliminates ~1000 lines of duplicate code across the 4 network simulators.
 */

import type { VehiclePosition, TravelDirection, TransportType, LineConfig } from '../../types/transit';
import type { PreprocessedRailwayLine } from '../trains/geometry';
import { sampleRailwayPosition } from '../trains/geometry';

// ============================================================================
// Types
// ============================================================================

/**
 * Stop/station with distance along line for ordering
 */
export interface StopWithDistance {
  id: string;
  name: string;
  distance: number; // Distance along the line in meters
  coordinates: [number, number];
}

/**
 * Result of finding previous/next stop
 */
export interface StopInfoResult {
  previousStopId: string | null;
  nextStopId: string | null;
  previousStopName: string | null;
  nextStopName: string | null;
  distanceToNextStop: number | null;
}

/**
 * Configuration for position simulator
 */
export interface PositionSimulatorConfig {
  /** Network type identifier */
  networkType: TransportType;
  /** Prefix for vehicle keys (e.g., 'metro', 'bus') */
  vehicleKeyPrefix: string;
  /** Prefix for route IDs (e.g., 'tmb-metro', 'tram') */
  routeIdPrefix: string;
  /** Position confidence level */
  confidence: 'high' | 'medium' | 'low';
  /** Log prefix for console output */
  logPrefix: string;
}

/**
 * Line-specific data needed for position generation
 */
export interface LineData {
  lineCode: string;
  railway: PreprocessedRailwayLine;
  config: LineConfig;
  lineColor?: string;
  orderedStops?: StopWithDistance[];
}

// ============================================================================
// Shared Utility Functions
// ============================================================================

/**
 * Find the closest distance along a railway line to a given point.
 * Used to order stops/stations by their position along the line.
 */
export function findClosestDistanceOnLine(
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
 * Find previous and next stop for a given distance along the line.
 */
export function findStopsBetween(
  distance: number,
  stops: StopWithDistance[],
  direction: TravelDirection
): StopInfoResult {
  if (stops.length === 0) {
    return {
      previousStopId: null,
      nextStopId: null,
      previousStopName: null,
      nextStopName: null,
      distanceToNextStop: null,
    };
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
    // If no next stop, wrap to first
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
    // If no next stop, wrap to last
    if (!nextStop && stops.length > 0) {
      nextStop = stops[stops.length - 1];
    }
  }

  // Calculate distance to next stop
  let distanceToNextStop: number | null = null;
  if (nextStop) {
    if (direction === 0) {
      distanceToNextStop = nextStop.distance - distance;
      if (distanceToNextStop < 0) {
        distanceToNextStop = null;
      }
    } else {
      distanceToNextStop = distance - nextStop.distance;
      if (distanceToNextStop < 0) {
        distanceToNextStop = null;
      }
    }
  }

  return {
    previousStopId: prevStop?.id ?? null,
    nextStopId: nextStop?.id ?? null,
    previousStopName: prevStop?.name ?? null,
    nextStopName: nextStop?.name ?? null,
    distanceToNextStop,
  };
}

/**
 * Order stops by their distance along the railway line.
 * Useful for networks that load stops separately and need to order them.
 */
export function orderStopsByDistance(
  stops: Array<{ id: string; name: string; coordinates: [number, number] }>,
  railway: PreprocessedRailwayLine
): StopWithDistance[] {
  const stopsWithDistance: StopWithDistance[] = stops.map((stop) => ({
    id: stop.id,
    name: stop.name,
    coordinates: stop.coordinates,
    distance: findClosestDistanceOnLine(stop.coordinates, railway),
  }));

  // Sort by distance along line
  stopsWithDistance.sort((a, b) => a.distance - b.distance);

  return stopsWithDistance;
}

// ============================================================================
// Position Generator
// ============================================================================

/**
 * Generate vehicle positions for a single line.
 * This is the core algorithm shared by all network simulators.
 */
export function generateLinePositions(
  simulatorConfig: PositionSimulatorConfig,
  lineData: LineData,
  currentTimeMs: number,
  vehiclesPerDirection: number
): VehiclePosition[] {
  const { networkType, vehicleKeyPrefix, routeIdPrefix, confidence } = simulatorConfig;
  const { lineCode, railway, config, lineColor, orderedStops } = lineData;

  if (vehiclesPerDirection === 0) {
    return [];
  }

  const vehicles: VehiclePosition[] = [];

  // Calculate spacing and time offset
  const spacing = railway.totalLength / vehiclesPerDirection;
  const headwayMs = config.headwaySeconds * 1000;
  const timeOffset = (currentTimeMs % headwayMs) / headwayMs;

  // Calculate speed in meters per second
  const speedMetersPerSecond = (config.avgSpeedKmh * 1000) / 3600;

  // Generate positions for both directions
  for (const direction of [0, 1] as TravelDirection[]) {
    for (let i = 0; i < vehiclesPerDirection; i++) {
      // Base distance along line
      const baseDistance = i * spacing;

      // Apply time-based offset for movement
      const adjustedDistance = (baseDistance + timeOffset * spacing) % railway.totalLength;

      // For return direction (1), measure from the other end
      const finalDistance =
        direction === 0 ? adjustedDistance : railway.totalLength - adjustedDistance;

      // Sample position and bearing from geometry
      const { position, bearing } = sampleRailwayPosition(railway, finalDistance);

      // Adjust bearing for return direction
      const finalBearing = direction === 1 ? (bearing + 180) % 360 : bearing;

      // Calculate progress as fraction of line length
      const progressFraction = finalDistance / railway.totalLength;

      // Find previous and next stops (if stop data is available)
      const stopInfo = orderedStops
        ? findStopsBetween(finalDistance, orderedStops, direction)
        : {
            previousStopId: null,
            nextStopId: null,
            previousStopName: null,
            nextStopName: null,
            distanceToNextStop: null,
          };

      // Calculate arrival time in minutes (if stop tracking is enabled)
      let arrivalMinutes: number | undefined;
      if (stopInfo.distanceToNextStop !== null && speedMetersPerSecond > 0) {
        const arrivalSeconds = stopInfo.distanceToNextStop / speedMetersPerSecond;
        arrivalMinutes = Math.ceil(arrivalSeconds / 60);
      }

      vehicles.push({
        vehicleKey: `${vehicleKeyPrefix}-${lineCode}-${direction}-${i}`,
        networkType,
        lineCode,
        routeId: `${routeIdPrefix}-${lineCode}`,
        latitude: position[1],
        longitude: position[0],
        bearing: finalBearing,
        source: 'schedule',
        confidence,
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
        lineTotalLength: railway.totalLength,
        arrivalMinutes,
        lineColor: lineColor ?? config.color,
      });
    }
  }

  return vehicles;
}

// ============================================================================
// Factory Types & Interface
// ============================================================================

/**
 * Stop feature interface for networks that track stops
 */
export interface StopFeature {
  id: string;
  name: string;
  coordinates: [number, number];
  lines: string[]; // Line codes this stop belongs to
}

/**
 * Data loading configuration for the simulator
 */
export interface DataLoadingConfig {
  /** Get all line codes for this network */
  getLineCodes: () => string[] | Promise<string[]>;

  /** Get configuration for a specific line */
  getLineConfig: (lineCode: string) => LineConfig | undefined;

  /** Calculate vehicles per direction for a line */
  calculateVehiclesPerDirection: (lengthMeters: number, lineCode: string) => number;

  /** Load preprocessed railway geometry for a line */
  loadPreprocessedLine: (lineCode: string) => Promise<PreprocessedRailwayLine | null>;

  /** Optional: Get custom line color (overrides config.color) */
  getLineColor?: (lineCode: string) => string | undefined;
}

/**
 * Optional stop tracking configuration
 */
export interface StopTrackingConfig {
  /** Load all stops into a map */
  loadStopsMap: () => Promise<Map<string, StopFeature>>;
}

/**
 * API returned by the factory
 */
export interface PositionSimulatorAPI {
  /** Generate positions for a single line */
  generateLinePositions: (lineCode: string, currentTimeMs: number) => Promise<VehiclePosition[]>;

  /** Generate positions for all lines */
  generateAllPositions: (currentTimeMs: number) => Promise<VehiclePosition[]>;

  /** Preload all line geometries */
  preloadGeometries: () => Promise<void>;

  /** Clear the cache */
  clearCache: () => void;

  /** Get a preprocessed line by code */
  getPreprocessedLine: (lineCode: string) => PreprocessedRailwayLine | null;

  /** Get simulator statistics */
  getStats: () => { cachedLines: number; totalExpectedVehicles: number };
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a position simulator for a transit network.
 *
 * @param simulatorConfig - Basic simulator configuration (network type, prefixes)
 * @param dataConfig - Data loading functions for the network
 * @param stopConfig - Optional stop tracking configuration
 * @returns Position simulator API
 *
 * @example
 * ```typescript
 * const metroSimulator = createPositionSimulator(
 *   {
 *     networkType: 'metro',
 *     vehicleKeyPrefix: 'metro',
 *     routeIdPrefix: 'tmb-metro',
 *     confidence: 'medium',
 *     logPrefix: '[MetroSimulator]',
 *   },
 *   {
 *     getLineCodes: getMetroLineCodes,
 *     getLineConfig: (code) => METRO_LINE_CONFIG[code],
 *     calculateVehiclesPerDirection: calculateTrainsPerDirection,
 *     loadPreprocessedLine: loadMetroPreprocessedLine,
 *     getLineColor: (code) => getMetroLineByCode(code)?.color,
 *   },
 *   {
 *     loadStopsMap: loadMetroStationsMap,
 *   }
 * );
 *
 * // Use the simulator
 * const positions = await metroSimulator.generateAllPositions(Date.now());
 * ```
 */
export function createPositionSimulator(
  simulatorConfig: PositionSimulatorConfig,
  dataConfig: DataLoadingConfig,
  stopConfig?: StopTrackingConfig
): PositionSimulatorAPI {
  const { logPrefix } = simulatorConfig;

  // Internal caches
  const preprocessedLineCache = new Map<string, PreprocessedRailwayLine>();
  const orderedStopsCache = new Map<string, StopWithDistance[]>();
  let stopsMapPromise: Promise<Map<string, StopFeature>> | null = null;

  /**
   * Load stops map (with deduplication)
   */
  async function getStopsMap(): Promise<Map<string, StopFeature> | null> {
    if (!stopConfig) return null;

    if (!stopsMapPromise) {
      stopsMapPromise = stopConfig.loadStopsMap();
    }
    return stopsMapPromise;
  }

  /**
   * Get ordered stops for a line
   */
  async function getOrderedStops(
    lineCode: string,
    railway: PreprocessedRailwayLine
  ): Promise<StopWithDistance[] | undefined> {
    if (!stopConfig) return undefined;

    const cacheKey = lineCode.toUpperCase();
    if (orderedStopsCache.has(cacheKey)) {
      return orderedStopsCache.get(cacheKey)!;
    }

    const stopsMap = await getStopsMap();
    if (!stopsMap) return undefined;

    // Find stops that belong to this line
    const lineStops: Array<{ id: string; name: string; coordinates: [number, number] }> = [];
    for (const [id, stop] of stopsMap) {
      if (stop.lines.includes(lineCode)) {
        lineStops.push({ id, name: stop.name, coordinates: stop.coordinates });
      }
    }

    const ordered = orderStopsByDistance(lineStops, railway);
    orderedStopsCache.set(cacheKey, ordered);
    console.log(`${logPrefix} Ordered ${ordered.length} stops for line ${lineCode}`);

    return ordered;
  }

  /**
   * Load and cache a preprocessed line
   */
  async function loadAndCacheLine(lineCode: string): Promise<PreprocessedRailwayLine | null> {
    const cacheKey = lineCode.toUpperCase();

    if (preprocessedLineCache.has(cacheKey)) {
      return preprocessedLineCache.get(cacheKey)!;
    }

    const preprocessed = await dataConfig.loadPreprocessedLine(lineCode);
    if (preprocessed) {
      preprocessedLineCache.set(cacheKey, preprocessed);
      console.log(
        `${logPrefix} Preprocessed line ${lineCode}: ${preprocessed.totalLength.toFixed(0)}m`
      );
    }

    return preprocessed;
  }

  // Return the API
  return {
    async generateLinePositions(lineCode: string, currentTimeMs: number): Promise<VehiclePosition[]> {
      const config = dataConfig.getLineConfig(lineCode);
      if (!config) {
        console.warn(`${logPrefix} No configuration for line ${lineCode}`);
        return [];
      }

      const railway = await loadAndCacheLine(lineCode);
      if (!railway) {
        return [];
      }

      const orderedStops = await getOrderedStops(lineCode, railway);
      const lineColor = dataConfig.getLineColor?.(lineCode);

      const vehiclesPerDirection = dataConfig.calculateVehiclesPerDirection(
        railway.totalLength,
        lineCode
      );

      return generateLinePositions(
        simulatorConfig,
        {
          lineCode,
          railway,
          config,
          lineColor,
          orderedStops,
        },
        currentTimeMs,
        vehiclesPerDirection
      );
    },

    async generateAllPositions(currentTimeMs: number): Promise<VehiclePosition[]> {
      const lineCodes = await dataConfig.getLineCodes();

      console.log(`${logPrefix} Generating positions for ${lineCodes.length} lines`);

      const linePositions = await Promise.all(
        lineCodes.map((lineCode) => this.generateLinePositions(lineCode, currentTimeMs))
      );

      const allPositions = linePositions.flat();
      console.log(`${logPrefix} Total: ${allPositions.length} vehicles`);

      return allPositions;
    },

    async preloadGeometries(): Promise<void> {
      const lineCodes = await dataConfig.getLineCodes();

      await Promise.all(lineCodes.map((lineCode) => loadAndCacheLine(lineCode)));

      console.log(`${logPrefix} Preloaded ${preprocessedLineCache.size} line geometries`);
    },

    clearCache(): void {
      preprocessedLineCache.clear();
      orderedStopsCache.clear();
      stopsMapPromise = null;
    },

    getPreprocessedLine(lineCode: string): PreprocessedRailwayLine | null {
      return preprocessedLineCache.get(lineCode.toUpperCase()) ?? null;
    },

    getStats(): { cachedLines: number; totalExpectedVehicles: number } {
      let totalExpectedVehicles = 0;

      for (const [lineCode, railway] of preprocessedLineCache) {
        const vehiclesPerDir = dataConfig.calculateVehiclesPerDirection(
          railway.totalLength,
          lineCode
        );
        totalExpectedVehicles += vehiclesPerDir * 2; // Both directions
      }

      return {
        cachedLines: preprocessedLineCache.size,
        totalExpectedVehicles,
      };
    },
  };
}
