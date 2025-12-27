/**
 * Line resolution abstraction for train positioning
 *
 * Provides a network-agnostic interface for resolving train-to-line relationships
 * and line geometry properties. This abstraction enables future support for
 * different transit networks (e.g., Metro) without changing position algorithms.
 *
 * Phase 0, Task T000a
 */

import type { TrainPosition, TripDetails } from '../../types/trains';

/**
 * Abstraction for resolving train-to-line relationships
 *
 * Different transit networks may have different ways of identifying
 * which line a train belongs to (e.g., routeId parsing, trip lookup).
 * This interface provides a common API for position algorithms.
 */
export interface LineResolver {
  /**
   * Resolve which line a train is operating on
   *
   * @param train - Train position data
   * @param tripDetails - Optional trip details for more accurate resolution
   * @returns Line ID (e.g., "R1", "R2") or null if cannot be resolved
   *
   * Examples:
   * - Rodalies: Extract "R1" from routeId "R1_MOLINS_MACANET"
   * - Metro: Use trip details to map to line ID
   */
  resolveLineId(train: TrainPosition, tripDetails?: TripDetails): string | null;

  /**
   * Check if a line serves a specific station
   *
   * Used for validation when trains report being at a station,
   * and for parking position calculations.
   *
   * @param lineId - Line identifier (e.g., "R1")
   * @param stationId - Station identifier
   * @returns true if line serves this station
   */
  lineServesStation(lineId: string, stationId: string): boolean;

  /**
   * Get the bearing of a line at a specific station
   *
   * Used for parking position calculations to orient trains
   * perpendicular to the track at a station.
   *
   * Bearings are precomputed during data load (see T000c) and cached
   * to avoid per-frame calculations.
   *
   * @param lineId - Line identifier (e.g., "R1")
   * @param stationId - Station identifier
   * @returns Bearing in degrees (0-360, where 0 is North) or 0 if not found
   */
  getLineBearingAtStation(lineId: string, stationId: string): number;
}

/**
 * Rodalies-specific line resolver
 *
 * Rodalies trains have routeId in format "R1_MOLINS_MACANET" where:
 * - "R1" is the line ID
 * - "MOLINS_MACANET" identifies the specific route variant
 *
 * This resolver extracts the line ID from the routeId prefix.
 */
export class RodaliesLineResolver implements LineResolver {
  /**
   * Cache of line bearings at stations
   * Key format: "lineId:stationId" → bearing in degrees
   *
   * Populated during data load (see T000c)
   */
  private bearingCache = new Map<string, number>();

  /**
   * Cache of line-station memberships
   * Key format: "lineId:stationId" → boolean
   *
   * Populated during initialization from station data
   */
  private membershipCache = new Map<string, boolean>();

  /**
   * Resolve line ID from train's routeId
   *
   * Rodalies routeId format: "R1_MOLINS_MACANET" → "R1"
   *
   * @param train - Train position data
   * @returns Line ID (e.g., "R1") or null if cannot be parsed
   */
  resolveLineId(train: TrainPosition): string | null {
    if (!train.routeId) {
      return null;
    }

    // Extract line prefix before first underscore
    // Examples:
    // - "R1_MOLINS_MACANET" → "R1"
    // - "R2_SANT_VICENC_GRANOLLERS" → "R2"
    // - "R11_PORTBOU_BARCELONA" → "R11"
    const match = train.routeId.match(/^([^_]+)/);
    return match ? match[1] : null;
  }

  /**
   * Check if a line serves a specific station
   *
   * Uses precomputed membership cache populated from station data
   *
   * @param lineId - Line identifier (e.g., "R1")
   * @param stationId - Station identifier
   * @returns true if line serves this station
   */
  lineServesStation(lineId: string, stationId: string): boolean {
    const key = `${lineId}:${stationId}`;
    return this.membershipCache.get(key) ?? false;
  }

  /**
   * Get the bearing of a line at a specific station
   *
   * Uses precomputed bearing cache populated during data load (T000c)
   *
   * @param lineId - Line identifier (e.g., "R1")
   * @param stationId - Station identifier
   * @returns Bearing in degrees (0-360) or 0 if not found
   */
  getLineBearingAtStation(lineId: string, stationId: string): number {
    const key = `${lineId}:${stationId}`;
    return this.bearingCache.get(key) ?? 0;
  }

  /**
   * Set the bearing of a line at a station
   *
   * Called during data load (T000c) to populate the bearing cache
   *
   * @param lineId - Line identifier (e.g., "R1")
   * @param stationId - Station identifier
   * @param bearing - Bearing in degrees (0-360)
   */
  setBearingAtStation(lineId: string, stationId: string, bearing: number): void {
    const key = `${lineId}:${stationId}`;
    this.bearingCache.set(key, bearing);
  }

  /**
   * Set line-station membership
   *
   * Called during initialization to populate the membership cache
   *
   * @param lineId - Line identifier (e.g., "R1")
   * @param stationId - Station identifier
   * @param serves - true if line serves this station
   */
  setLineServesStation(lineId: string, stationId: string, serves: boolean): void {
    const key = `${lineId}:${stationId}`;
    this.membershipCache.set(key, serves);
  }

  /**
   * Get cache statistics for debugging
   *
   * @returns Object with cache sizes
   */
  getCacheStats(): { bearings: number; memberships: number } {
    return {
      bearings: this.bearingCache.size,
      memberships: this.membershipCache.size,
    };
  }

  /**
   * Clear all caches
   *
   * Useful for testing or reinitialization
   */
  clearCaches(): void {
    this.bearingCache.clear();
    this.membershipCache.clear();
  }
}
