/**
 * Hook for fetching Metro vehicle positions from the API
 *
 * Fetches Metro train positions from the backend API with polling.
 * Falls back to schedule-based simulation if the API is unavailable.
 * Updates positions every 30 seconds (same as Rodalies).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { VehiclePosition } from '../../../types/transit';
import type { MetroApiPosition } from '../../../types/metro';
import { fetchMetroPositions } from '../../../lib/api/metro';
import {
  generateAllMetroPositions,
  preloadMetroGeometries,
} from '../../../lib/metro/positionSimulator';

/**
 * Polling interval in milliseconds (30 seconds)
 * Matches Rodalies polling interval
 */
const POLLING_INTERVAL_MS = 30000;

export interface UseMetroPositionsOptions {
  /** Whether position fetching is enabled (default: true) */
  enabled?: boolean;
  /** Optional line code to filter (e.g., "L1", "L3") */
  lineCode?: string;
  /** Polling interval in ms (default: 30000) */
  intervalMs?: number;
}

export interface UseMetroPositionsResult {
  /** Current vehicle positions */
  positions: VehiclePosition[];
  /** Previous vehicle positions (for animation interpolation) */
  previousPositions: VehiclePosition[];
  /** Whether data is loaded and ready */
  isReady: boolean;
  /** Whether positions are currently being fetched */
  isLoading: boolean;
  /** Error message if fetching failed */
  error: string | null;
  /** Number of vehicles */
  vehicleCount: number;
  /** Manually trigger a position fetch */
  refresh: () => void;
  /** Whether using simulation fallback */
  isSimulationFallback: boolean;
  /** Timestamp when positions were polled (ISO string) */
  polledAt: string | null;
  /** Timestamp when previous positions were polled (ISO string) */
  previousPolledAt: string | null;
}

/**
 * Converts API MetroPosition to frontend VehiclePosition format
 */
function apiToVehiclePosition(apiPos: MetroApiPosition): VehiclePosition {
  return {
    vehicleKey: apiPos.vehicleKey,
    networkType: 'metro',
    lineCode: apiPos.lineCode,
    routeId: apiPos.routeId ?? undefined,
    latitude: apiPos.latitude,
    longitude: apiPos.longitude,
    bearing: apiPos.bearing ?? 0,
    source: apiPos.source === 'imetro' ? 'ibus' : 'schedule',
    confidence: apiPos.confidence,
    estimatedAt: new Date(apiPos.estimatedAt).getTime(),
    direction: apiPos.direction,
    previousStopId: apiPos.previousStopId,
    nextStopId: apiPos.nextStopId,
    previousStopName: apiPos.previousStopName,
    nextStopName: apiPos.nextStopName,
    status: apiPos.status,
    progressFraction: apiPos.progressFraction ?? 0,
    distanceAlongLine: apiPos.distanceAlongLine ?? 0,
    speedMetersPerSecond: apiPos.speedMetersPerSecond ?? 0,
    lineTotalLength: apiPos.lineTotalLength ?? 0,
    arrivalMinutes: apiPos.arrivalSecondsToNext
      ? Math.ceil(apiPos.arrivalSecondsToNext / 60)
      : undefined,
    lineColor: apiPos.lineColor,
  };
}

/**
 * Hook to fetch Metro vehicle positions from the API
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
  const { enabled = true, lineCode, intervalMs = POLLING_INTERVAL_MS } = options;

  const [positions, setPositions] = useState<VehiclePosition[]>([]);
  const [previousPositions, setPreviousPositions] = useState<VehiclePosition[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSimulationFallback, setIsSimulationFallback] = useState(false);
  const [polledAt, setPolledAt] = useState<string | null>(null);
  const [previousPolledAt, setPreviousPolledAt] = useState<string | null>(null);

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);
  const isPreloadingRef = useRef(false);
  const geometriesLoadedRef = useRef(false);

  /**
   * Fetch positions from API
   */
  const fetchFromApi = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetchMetroPositions(lineCode);

      if (response.positions.length === 0) {
        // API returned no data - use simulation
        return false;
      }

      // Convert API positions to VehiclePosition format
      const newPositions = response.positions.map(apiToVehiclePosition);
      const newPreviousPositions = response.previousPositions
        ? response.previousPositions.map(apiToVehiclePosition)
        : [];

      setPositions(newPositions);
      setPreviousPositions(newPreviousPositions);
      setPolledAt(response.polledAt);
      setPreviousPolledAt(response.previousPolledAt ?? null);
      setError(null);
      setIsSimulationFallback(false);
      retryCountRef.current = 0;

      console.log(
        `Metro API: ${newPositions.length} positions fetched (${newPreviousPositions.length} previous)`
      );

      return true;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to fetch Metro positions';
      console.warn('Metro API error:', errorMessage);
      return false;
    }
  }, [lineCode]);

  /**
   * Generate simulated positions (fallback)
   */
  const fetchFromSimulation = useCallback(async () => {
    try {
      // Ensure geometries are preloaded
      if (!geometriesLoadedRef.current) {
        await preloadMetroGeometries();
        geometriesLoadedRef.current = true;
      }

      const now = Date.now();
      const simulatedPositions = await generateAllMetroPositions(now);

      setPositions(simulatedPositions);
      setPreviousPositions([]);  // No previous positions for simulation
      setPolledAt(new Date().toISOString());
      setPreviousPolledAt(null);
      setIsSimulationFallback(true);

      console.log(
        `Metro simulation: ${simulatedPositions.length} positions generated`
      );

      return true;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to simulate Metro positions';
      setError(errorMessage);
      console.error('Metro simulation error:', err);
      return false;
    }
  }, []);

  /**
   * Fetch positions (API first, then simulation fallback)
   */
  const fetchPositions = useCallback(async () => {
    setIsLoading(true);

    // Try API first
    const apiSuccess = await fetchFromApi();

    if (!apiSuccess) {
      // Fall back to simulation
      console.log('Metro: Falling back to simulation');
      await fetchFromSimulation();
    }

    setIsReady(true);
    setIsLoading(false);
  }, [fetchFromApi, fetchFromSimulation]);

  /**
   * Manual refresh trigger
   */
  const refresh = useCallback(() => {
    void fetchPositions();
  }, [fetchPositions]);

  /**
   * Preload geometries on mount (for simulation fallback)
   */
  useEffect(() => {
    if (!enabled || isPreloadingRef.current) return;

    isPreloadingRef.current = true;

    async function preload() {
      try {
        await preloadMetroGeometries();
        geometriesLoadedRef.current = true;
        console.log('Metro: Geometries preloaded for simulation fallback');
      } catch (err) {
        console.warn('Failed to preload Metro geometries:', err);
        // Non-fatal - API might still work
      }
    }

    void preload();
  }, [enabled]);

  /**
   * Set up polling when enabled
   */
  useEffect(() => {
    if (!enabled) {
      // Clear timers when disabled
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      return;
    }

    // Initial fetch
    void fetchPositions();

    // Set up polling interval
    pollingIntervalRef.current = setInterval(() => {
      void fetchPositions();
    }, intervalMs);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, [enabled, intervalMs, fetchPositions]);

  return {
    positions,
    previousPositions,
    isReady,
    isLoading,
    error,
    vehicleCount: positions.length,
    refresh,
    isSimulationFallback,
    polledAt,
    previousPolledAt,
  };
}
