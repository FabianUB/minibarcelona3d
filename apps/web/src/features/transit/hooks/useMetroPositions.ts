/**
 * Hook for generating Metro vehicle positions
 *
 * Generates simulated Metro train positions based on schedule data.
 * Updates positions at regular intervals for smooth animation.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { VehiclePosition } from '../../../types/transit';
import {
  generateAllMetroPositions,
  preloadMetroGeometries,
} from '../../../lib/metro/positionSimulator';
import { METRO_SIMULATION_INTERVAL_MS } from '../../../config/metroConfig';

export interface UseMetroPositionsOptions {
  /** Whether position generation is enabled (default: true) */
  enabled?: boolean;
  /** Simulation update interval in ms (default: from metroConfig) */
  intervalMs?: number;
}

export interface UseMetroPositionsResult {
  /** Current vehicle positions */
  positions: VehiclePosition[];
  /** Whether geometries are loaded and ready */
  isReady: boolean;
  /** Whether positions are currently being generated */
  isLoading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** Number of vehicles currently being simulated */
  vehicleCount: number;
  /** Manually trigger a position update */
  refresh: () => void;
}

/**
 * Hook to generate simulated Metro vehicle positions
 *
 * @param options - Configuration options
 * @returns Position data and status
 *
 * @example
 * const { positions, isReady, isLoading } = useMetroPositions({ enabled: true });
 */
export function useMetroPositions(
  options: UseMetroPositionsOptions = {}
): UseMetroPositionsResult {
  const { enabled = true, intervalMs = METRO_SIMULATION_INTERVAL_MS } = options;

  const [positions, setPositions] = useState<VehiclePosition[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isPreloadingRef = useRef(false);

  /**
   * Generate positions for current time
   */
  const generatePositions = useCallback(async () => {
    if (!isReady) return;

    try {
      const now = Date.now();
      const newPositions = await generateAllMetroPositions(now);
      setPositions(newPositions);
    } catch (err) {
      console.error('Failed to generate Metro positions:', err);
      // Don't set error here - just log it, positions will be stale
    }
  }, [isReady]);

  /**
   * Manual refresh trigger
   */
  const refresh = useCallback(() => {
    generatePositions();
  }, [generatePositions]);

  /**
   * Preload geometries on mount
   */
  useEffect(() => {
    if (!enabled || isPreloadingRef.current) return;

    isPreloadingRef.current = true;

    async function preload() {
      try {
        setIsLoading(true);
        setError(null);

        await preloadMetroGeometries();

        setIsReady(true);
        setIsLoading(false);

        // Generate initial positions
        const now = Date.now();
        const initialPositions = await generateAllMetroPositions(now);
        setPositions(initialPositions);

        console.log(
          `Metro positions ready: ${initialPositions.length} vehicles`
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load Metro data';
        setError(message);
        setIsLoading(false);
        console.error('Failed to preload Metro geometries:', err);
      }
    }

    preload();
  }, [enabled]);

  /**
   * Start position update interval when ready
   */
  useEffect(() => {
    if (!enabled || !isReady) return;

    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    // Start new interval
    intervalRef.current = setInterval(() => {
      generatePositions();
    }, intervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, isReady, intervalMs, generatePositions]);

  return {
    positions,
    isReady,
    isLoading,
    error,
    vehicleCount: positions.length,
    refresh,
  };
}
