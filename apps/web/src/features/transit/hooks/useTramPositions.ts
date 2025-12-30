/**
 * Hook for generating TRAM vehicle positions
 *
 * Generates simulated TRAM positions based on schedule data.
 * Updates positions at regular intervals for smooth animation.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { VehiclePosition } from '../../../types/transit';
import {
  generateAllTramPositions,
  preloadTramGeometries,
} from '../../../lib/tram/positionSimulator';
import { TRAM_SIMULATION_INTERVAL_MS } from '../../../config/tramConfig';

export interface UseTramPositionsOptions {
  enabled?: boolean;
  intervalMs?: number;
}

export interface UseTramPositionsResult {
  positions: VehiclePosition[];
  isReady: boolean;
  isLoading: boolean;
  error: string | null;
  vehicleCount: number;
  refresh: () => void;
}

export function useTramPositions(
  options: UseTramPositionsOptions = {}
): UseTramPositionsResult {
  const { enabled = true, intervalMs = TRAM_SIMULATION_INTERVAL_MS } = options;

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
      const newPositions = await generateAllTramPositions(now);
      setPositions(newPositions);
    } catch (err) {
      console.error('Failed to generate TRAM positions:', err);
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

        await preloadTramGeometries();

        setIsReady(true);
        setIsLoading(false);

        const now = Date.now();
        const initialPositions = await generateAllTramPositions(now);
        setPositions(initialPositions);

        console.log(`TRAM positions ready: ${initialPositions.length} vehicles`);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load TRAM data';
        setError(message);
        setIsLoading(false);
        console.error('Failed to preload TRAM geometries:', err);
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
