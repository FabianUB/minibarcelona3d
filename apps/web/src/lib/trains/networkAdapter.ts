/**
 * Transit network adapter for position algorithms
 *
 * Provides a network-agnostic configuration layer that encapsulates
 * network-specific behavior (Rodalies, Metro) for position calculation.
 *
 * This abstraction allows the position algorithms to work with any
 * transit network without modification.
 *
 * Phase 0, Task T000b
 */

import type { LineResolver } from './lineResolver';
import { RodaliesLineResolver } from './lineResolver';

/**
 * Network type identifier
 */
export type NetworkType = 'rodalies' | 'metro';

/**
 * Configuration for station parking behavior
 */
export interface ParkingConfig {
  /**
   * Maximum number of parking slots around a station
   * When more trains are stopped than slots, they stack with slight offsets
   */
  maxSlots: number;

  /**
   * Base spacing between parking slots in meters at reference zoom
   * Actual spacing scales with map zoom level
   */
  baseSpacingMeters: number;

  /**
   * Zoom level at which baseSpacingMeters is measured
   * Spacing scales proportionally at other zoom levels
   */
  referenceZoom: number;

  /**
   * Scaling factor for spacing adjustment with zoom
   * spacing = baseSpacing * (1 + (currentZoom - referenceZoom) * scaleFactor)
   */
  zoomScaleFactor: number;

  /**
   * Duration in milliseconds for smooth transition when entering/exiting parking
   */
  transitionDurationMs: number;

  /**
   * For Metro: Group trains by line at multi-line stations
   * When true, each line gets its own perpendicular direction at interchanges
   */
  groupByLine?: boolean;

  /**
   * For Metro: Sector angle in degrees for each line's parking zone
   * Only used when groupByLine is true
   */
  lineSectorAngle?: number;
}

/**
 * Configuration for predictive position interpolation
 */
export interface PredictiveConfig {
  /**
   * Maximum age of GPS data in seconds before considered stale
   * When GPS is fresher than this, it's blended with predictions
   */
  gpsStaleThresholdSeconds: number;

  /**
   * Weight for predicted position when blending with GPS (0-1)
   * 0.7 means 70% predicted, 30% GPS
   */
  predictedWeight: number;

  /**
   * Weight for GPS position when blending with prediction (0-1)
   * Should equal 1 - predictedWeight
   */
  gpsWeight: number;

  /**
   * Minimum confidence threshold (0-1) for using predicted position
   * Below this, fall back to GPS-only
   */
  minConfidence: number;

  /**
   * Interpolation update frequency in Hz (frames per second)
   * 60 Hz = smooth 60 FPS animation
   */
  interpolationFPS: number;

  /**
   * Cache TTL for trip details in milliseconds
   * Trip data is cached to reduce API load
   */
  tripCacheTTLMs: number;

  /**
   * Maximum number of trip details to cache
   * Oldest entries evicted when limit exceeded
   */
  tripCacheMaxEntries: number;
}

/**
 * Transit network adapter
 *
 * Encapsulates all network-specific configuration and behavior
 * required for position calculation algorithms.
 */
export interface TransitNetworkAdapter {
  /**
   * Network type identifier
   */
  networkType: NetworkType;

  /**
   * Line resolver for train-to-line relationship resolution
   */
  lineResolver: LineResolver;

  /**
   * Station parking configuration
   */
  parkingConfig: ParkingConfig;

  /**
   * Predictive interpolation configuration
   */
  predictiveConfig: PredictiveConfig;
}

/**
 * Create a Rodalies network adapter with default configuration
 *
 * Rodalies-specific characteristics:
 * - Line ID extracted from routeId prefix (e.g., "R1_MOLINS_MACANET" → "R1")
 * - Parking slots arranged perpendicular to track (no line grouping)
 * - 5 parking slots per station, 20m base spacing
 * - 70/30 predicted/GPS blend when GPS is recent
 *
 * @param lineResolver - Optional custom line resolver (creates default if not provided)
 * @returns Configured TransitNetworkAdapter for Rodalies network
 *
 * Phase 0, Task T000b
 */
export function createRodaliesAdapter(
  lineResolver?: LineResolver
): TransitNetworkAdapter {
  return {
    networkType: 'rodalies',

    lineResolver: lineResolver ?? new RodaliesLineResolver(),

    parkingConfig: {
      maxSlots: 5,
      baseSpacingMeters: 20,
      referenceZoom: 14,
      zoomScaleFactor: 0.1,
      transitionDurationMs: 500,
      // Rodalies doesn't need line grouping (no multi-line interchanges like Metro)
      groupByLine: false,
    },

    predictiveConfig: {
      gpsStaleThresholdSeconds: 30,
      predictedWeight: 0.7,
      gpsWeight: 0.3,
      minConfidence: 0.5,
      interpolationFPS: 60,
      tripCacheTTLMs: 10 * 60 * 1000, // 10 minutes
      tripCacheMaxEntries: 200,
    },
  };
}

/**
 * Create a Metro network adapter with default configuration
 *
 * Metro-specific characteristics:
 * - Line ID resolved from trip details or station membership
 * - Parking slots grouped by line at multi-line interchanges
 * - Each line gets 60° sector for parking at major interchanges
 * - Higher confidence threshold (Metro schedules are typically more accurate)
 *
 * @param _lineResolver - Line resolver implementation (required for Metro, unused until implemented)
 * @returns Configured TransitNetworkAdapter for Metro network
 *
 * Phase 0, Task T000b
 *
 * Note: Metro support is planned for future implementation.
 * This factory exists to define the interface but will throw until
 * Metro data and line resolver are available.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createMetroAdapter(_lineResolver: LineResolver): TransitNetworkAdapter {
  // Future implementation placeholder
  // Will be activated when Metro data is available
  throw new Error(
    'Metro adapter not yet implemented. Requires Metro data and MetroLineResolver.'
  );

  // Future configuration (commented for reference):
  // return {
  //   networkType: 'metro',
  //
  //   lineResolver,
  //
  //   parkingConfig: {
  //     maxSlots: 5,
  //     baseSpacingMeters: 15, // Metro trains closer together
  //     referenceZoom: 15,     // Metro viewed at higher zoom
  //     zoomScaleFactor: 0.12,
  //     transitionDurationMs: 400,
  //     groupByLine: true,     // Group by line at interchanges
  //     lineSectorAngle: 60,   // Each line gets 60° sector
  //   },
  //
  //   predictiveConfig: {
  //     gpsStaleThresholdSeconds: 20, // Metro updates more frequently
  //     predictedWeight: 0.8,          // Higher confidence in Metro schedules
  //     gpsWeight: 0.2,
  //     minConfidence: 0.6,
  //     interpolationFPS: 60,
  //     tripCacheTTLMs: 15 * 60 * 1000, // 15 minutes (longer trips)
  //     tripCacheMaxEntries: 300,       // More trains in Metro
  //   },
  // };
}
