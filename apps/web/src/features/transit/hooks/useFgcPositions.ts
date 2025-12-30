/**
 * Hook for generating FGC vehicle positions
 *
 * Generates simulated FGC train positions based on schedule data.
 * Updates positions at regular intervals for smooth animation.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { VehiclePosition } from '../../../types/transit';
import {
  generateAllFgcPositions,
  preloadFgcGeometries,
} from '../../../lib/fgc/positionSimulator';
import { FGC_SIMULATION_INTERVAL_MS } from '../../../config/fgcConfig';

export interface UseFgcPositionsOptions {
  enabled?: boolean;
  intervalMs?: number;
}

export interface UseFgcPositionsResult {
  positions: VehiclePosition[];
  isReady: boolean;
  isLoading: boolean;
  error: string | null;
  vehicleCount: number;
  refresh: () => void;
}

export function useFgcPositions(
  options: UseFgcPositionsOptions = {}
): UseFgcPositionsResult {
  const { enabled = true, intervalMs = FGC_SIMULATION_INTERVAL_MS } = options;

  const [positions, setPositions] = useState<VehiclePosition[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isPreloadingRef = useRef(false);

  const generatePositions = useCallback(async () => {
    if (!isReady) return;

    try {
      const now = Date.now();
      const newPositions = await generateAllFgcPositions(now);
      setPositions(newPositions);
    } catch (err) {
      console.error('Failed to generate FGC positions:', err);
    }
  }, [isReady]);

  const refresh = useCallback(() => {
    generatePositions();
  }, [generatePositions]);

  // Preload geometries on mount
  useEffect(() => {
    if (!enabled || isPreloadingRef.current) return;

    isPreloadingRef.current = true;

    async function preload() {
      try {
        setIsLoading(true);
        setError(null);

        await preloadFgcGeometries();

        setIsReady(true);
        setIsLoading(false);

        const now = Date.now();
        const initialPositions = await generateAllFgcPositions(now);
        setPositions(initialPositions);

        console.log(`FGC positions ready: ${initialPositions.length} vehicles`);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load FGC data';
        setError(message);
        setIsLoading(false);
        console.error('Failed to preload FGC geometries:', err);
      }
    }

    preload();
  }, [enabled]);

  // Start position update interval when ready
  useEffect(() => {
    if (!enabled || !isReady) return;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

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
