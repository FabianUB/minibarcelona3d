/**
 * Generic hook for generating transit vehicle positions
 *
 * Provides a reusable base for bus, tram, FGC, and metro position hooks.
 * Generates simulated positions based on schedule data and updates at regular intervals.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { VehiclePosition } from '../../../types/transit';

export interface TransitPositionsConfig {
  /** Human-readable name for logging (e.g., "Bus", "TRAM") */
  name: string;
  /** Default simulation update interval in ms */
  defaultIntervalMs: number;
  /** Function to preload geometries/data */
  preloadGeometries: () => Promise<void>;
  /** Function to generate positions for current time */
  generatePositions: (timestamp: number) => Promise<VehiclePosition[]>;
}

export interface UseTransitPositionsOptions {
  /** Whether position generation is enabled (default: true) */
  enabled?: boolean;
  /** Simulation update interval in ms (default: from config) */
  intervalMs?: number;
}

export interface UseTransitPositionsResult {
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
 * Generic hook to generate simulated transit vehicle positions
 *
 * @param config - Transit-specific configuration (name, functions)
 * @param options - Runtime options
 * @returns Position data and status
 */
export function useTransitPositions(
  config: TransitPositionsConfig,
  options: UseTransitPositionsOptions = {}
): UseTransitPositionsResult {
  const { name, defaultIntervalMs, preloadGeometries, generatePositions: generatePositionsFn } = config;
  const { enabled = true, intervalMs = defaultIntervalMs } = options;

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
      const newPositions = await generatePositionsFn(now);
      setPositions(newPositions);
    } catch (err) {
      console.error(`Failed to generate ${name} positions:`, err);
    }
  }, [isReady, generatePositionsFn, name]);

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

        await preloadGeometries();

        setIsReady(true);
        setIsLoading(false);

        // Generate initial positions
        const now = Date.now();
        const initialPositions = await generatePositionsFn(now);
        setPositions(initialPositions);

        console.log(`${name} positions ready: ${initialPositions.length} vehicles`);
      } catch (err) {
        const message = err instanceof Error ? err.message : `Failed to load ${name} data`;
        setError(message);
        setIsLoading(false);
        console.error(`Failed to preload ${name} geometries:`, err);
      }
    }

    preload();
  }, [enabled, name, preloadGeometries, generatePositionsFn]);

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
