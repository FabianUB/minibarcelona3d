/**
 * Schedule-based position interpolator for transit vehicles
 *
 * Provides smooth animation between position updates by interpolating
 * vehicle positions over time. Works for both simulated (Metro) and
 * API-based (Bus) position sources.
 *
 * Re-exports geometry functions for convenience.
 */

import type { VehiclePosition, VehicleAnimationState } from '../../types/transit';
import {
  interpolatePosition,
  interpolatePositionSmooth,
  easeInOutCubic,
  type Position,
} from '../trains/geometry';

// Re-export geometry functions for convenience
export { interpolatePosition, interpolatePositionSmooth, easeInOutCubic };
export type { Position };

/**
 * Animation state manager for smooth vehicle movement
 */
export class VehicleAnimationManager {
  private states: Map<string, VehicleAnimationState> = new Map();
  private defaultDuration: number;

  /**
   * @param defaultDurationMs - Default interpolation duration in milliseconds
   */
  constructor(defaultDurationMs = 4500) {
    this.defaultDuration = defaultDurationMs;
  }

  /**
   * Update target position for a vehicle
   * If vehicle doesn't exist, creates new state at target position
   */
  updateTarget(
    vehicleKey: string,
    targetPosition: Position,
    targetBearing: number,
    durationMs?: number
  ): void {
    const existing = this.states.get(vehicleKey);
    const now = Date.now();
    const duration = durationMs ?? this.defaultDuration;

    if (existing) {
      // Get current interpolated position as new start
      const currentInterpolated = this.getInterpolatedPosition(vehicleKey, now);

      this.states.set(vehicleKey, {
        vehicleKey,
        currentPosition: currentInterpolated ?? existing.currentPosition,
        targetPosition,
        currentBearing: existing.currentBearing,
        targetBearing,
        lastUpdate: now,
        interpolationDuration: duration,
      });
    } else {
      // New vehicle - start at target position (no animation needed)
      this.states.set(vehicleKey, {
        vehicleKey,
        currentPosition: targetPosition,
        targetPosition,
        currentBearing: targetBearing,
        targetBearing,
        lastUpdate: now,
        interpolationDuration: duration,
      });
    }
  }

  /**
   * Get interpolated position for a vehicle at the given time
   */
  getInterpolatedPosition(
    vehicleKey: string,
    currentTimeMs: number
  ): Position | null {
    const state = this.states.get(vehicleKey);
    if (!state) return null;

    const elapsed = currentTimeMs - state.lastUpdate;
    const progress = Math.min(elapsed / state.interpolationDuration, 1.0);

    return interpolatePositionSmooth(
      state.currentPosition,
      state.targetPosition,
      progress
    );
  }

  /**
   * Get interpolated bearing for a vehicle at the given time
   */
  getInterpolatedBearing(
    vehicleKey: string,
    currentTimeMs: number
  ): number | null {
    const state = this.states.get(vehicleKey);
    if (!state) return null;

    const elapsed = currentTimeMs - state.lastUpdate;
    const progress = Math.min(elapsed / state.interpolationDuration, 1.0);
    const easedProgress = easeInOutCubic(progress);

    // Interpolate bearing, handling wrap-around at 360 degrees
    return interpolateBearing(
      state.currentBearing,
      state.targetBearing,
      easedProgress
    );
  }

  /**
   * Get full interpolated state for a vehicle
   */
  getInterpolatedState(
    vehicleKey: string,
    currentTimeMs: number
  ): { position: Position; bearing: number } | null {
    const position = this.getInterpolatedPosition(vehicleKey, currentTimeMs);
    const bearing = this.getInterpolatedBearing(vehicleKey, currentTimeMs);

    if (!position || bearing === null) return null;

    return { position, bearing };
  }

  /**
   * Remove a vehicle from tracking
   */
  remove(vehicleKey: string): boolean {
    return this.states.delete(vehicleKey);
  }

  /**
   * Remove vehicles not in the provided set
   * Returns keys of removed vehicles
   */
  pruneExcept(activeKeys: Set<string>): string[] {
    const removed: string[] = [];

    for (const key of this.states.keys()) {
      if (!activeKeys.has(key)) {
        this.states.delete(key);
        removed.push(key);
      }
    }

    return removed;
  }

  /**
   * Check if a vehicle is being tracked
   */
  has(vehicleKey: string): boolean {
    return this.states.has(vehicleKey);
  }

  /**
   * Get number of tracked vehicles
   */
  get size(): number {
    return this.states.size;
  }

  /**
   * Clear all tracked vehicles
   */
  clear(): void {
    this.states.clear();
  }

  /**
   * Get all tracked vehicle keys
   */
  keys(): IterableIterator<string> {
    return this.states.keys();
  }
}

/**
 * Interpolate between two bearings, handling wrap-around at 360 degrees
 *
 * @param from - Starting bearing (0-360)
 * @param to - Target bearing (0-360)
 * @param t - Interpolation factor (0.0 to 1.0)
 * @returns Interpolated bearing (0-360)
 */
export function interpolateBearing(from: number, to: number, t: number): number {
  // Normalize bearings to 0-360 range
  from = ((from % 360) + 360) % 360;
  to = ((to % 360) + 360) % 360;

  // Calculate the difference
  let diff = to - from;

  // Take the shortest path around the circle
  if (diff > 180) {
    diff -= 360;
  } else if (diff < -180) {
    diff += 360;
  }

  // Interpolate and normalize result
  const result = from + diff * t;
  return ((result % 360) + 360) % 360;
}

/**
 * Batch update animation targets from vehicle positions
 */
export function updateAnimationTargets(
  manager: VehicleAnimationManager,
  positions: VehiclePosition[],
  durationMs?: number
): void {
  for (const vehicle of positions) {
    manager.updateTarget(
      vehicle.vehicleKey,
      [vehicle.longitude, vehicle.latitude],
      vehicle.bearing,
      durationMs
    );
  }
}

/**
 * Get all interpolated positions for current time
 */
export function getAllInterpolatedPositions(
  manager: VehicleAnimationManager,
  positions: VehiclePosition[],
  currentTimeMs: number
): Map<string, { position: Position; bearing: number }> {
  const result = new Map<string, { position: Position; bearing: number }>();

  for (const vehicle of positions) {
    const interpolated = manager.getInterpolatedState(
      vehicle.vehicleKey,
      currentTimeMs
    );

    if (interpolated) {
      result.set(vehicle.vehicleKey, interpolated);
    } else {
      // Fallback to original position if not tracked
      result.set(vehicle.vehicleKey, {
        position: [vehicle.longitude, vehicle.latitude],
        bearing: vehicle.bearing,
      });
    }
  }

  return result;
}
