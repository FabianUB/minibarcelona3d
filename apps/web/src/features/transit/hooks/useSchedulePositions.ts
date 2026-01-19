/**
 * Hook for fetching schedule-based vehicle positions from API
 *
 * Fetches pre-calculated positions for TRAM, FGC, and Bus networks
 * from the backend API. Falls back to client-side simulation if API unavailable.
 * Updates positions every 30 seconds to match backend polling.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { VehiclePosition } from '../../../types/transit';
import {
  fetchSchedulePositions,
  type ScheduleNetworkType,
} from '../../../lib/api/transit';

/**
 * Polling interval in milliseconds (30 seconds)
 * Matches backend pre-calculation interval
 */
const POLLING_INTERVAL_MS = 30000;

export interface UseSchedulePositionsOptions {
  /** Whether position fetching is enabled (default: true) */
  enabled?: boolean;
  /** Network type to filter ('tram', 'fgc', 'bus') */
  network: ScheduleNetworkType;
  /** Polling interval in ms (default: 30000) */
  intervalMs?: number;
  /** Optional simulation fallback generator */
  simulationFallback?: (timestamp: number) => Promise<VehiclePosition[]>;
  /** Optional geometry preloader for simulation fallback */
  preloadGeometries?: () => Promise<void>;
}

export interface UseSchedulePositionsResult {
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
 * Hook to fetch schedule-based vehicle positions from the API
 *
 * @param options - Configuration options including required network type
 * @returns Position data and status
 *
 * @example
 * const { positions, isReady } = useSchedulePositions({
 *   enabled: true,
 *   network: 'tram',
 *   simulationFallback: generateAllTramPositions,
 *   preloadGeometries: preloadTramGeometries,
 * });
 */
export function useSchedulePositions(
  options: UseSchedulePositionsOptions
): UseSchedulePositionsResult {
  const {
    enabled = true,
    network,
    intervalMs = POLLING_INTERVAL_MS,
    simulationFallback,
    preloadGeometries,
  } = options;

  const [positions, setPositions] = useState<VehiclePosition[]>([]);
  const [previousPositions, setPreviousPositions] = useState<VehiclePosition[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSimulationFallback, setIsSimulationFallback] = useState(false);
  const [polledAt, setPolledAt] = useState<string | null>(null);
  const [previousPolledAt, setPreviousPolledAt] = useState<string | null>(null);

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const geometriesLoadedRef = useRef(false);
  const lastPositionsRef = useRef<VehiclePosition[]>([]);
  const lastPolledAtRef = useRef<string | null>(null);

  /**
   * Fetch positions from API
   */
  const fetchFromApi = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetchSchedulePositions(network);

      if (response.positions.length === 0) {
        // API returned no data - may need simulation
        return false;
      }

      // Store previous positions for animation interpolation
      if (lastPositionsRef.current.length > 0) {
        setPreviousPositions(lastPositionsRef.current);
        setPreviousPolledAt(lastPolledAtRef.current);
      }

      lastPositionsRef.current = response.positions;
      lastPolledAtRef.current = response.polledAt;

      setPositions(response.positions);
      setPolledAt(response.polledAt);
      setError(null);
      setIsSimulationFallback(false);

      const networkName = network.toUpperCase();
      console.log(
        `${networkName} API: ${response.positions.length} positions fetched`
      );

      return true;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : `Failed to fetch ${network} positions`;
      console.warn(`${network.toUpperCase()} API error:`, errorMessage);
      return false;
    }
  }, [network]);

  /**
   * Generate simulated positions (fallback)
   */
  const fetchFromSimulation = useCallback(async () => {
    if (!simulationFallback) {
      setError(`No simulation fallback configured for ${network}`);
      return false;
    }

    try {
      // Ensure geometries are preloaded if available
      if (preloadGeometries && !geometriesLoadedRef.current) {
        await preloadGeometries();
        geometriesLoadedRef.current = true;
      }

      const now = Date.now();
      const simulatedPositions = await simulationFallback(now);

      setPositions(simulatedPositions);
      setPreviousPositions([]);
      setPolledAt(new Date().toISOString());
      setPreviousPolledAt(null);
      setIsSimulationFallback(true);

      console.log(
        `${network.toUpperCase()} simulation: ${simulatedPositions.length} positions generated`
      );

      return true;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : `Failed to simulate ${network} positions`;
      setError(errorMessage);
      console.error(`${network.toUpperCase()} simulation error:`, err);
      return false;
    }
  }, [network, simulationFallback, preloadGeometries]);

  /**
   * Fetch positions (API first, then simulation fallback)
   */
  const fetchPositions = useCallback(async () => {
    setIsLoading(true);

    // Try API first
    const apiSuccess = await fetchFromApi();

    if (!apiSuccess && simulationFallback) {
      // Fall back to simulation
      console.log(`${network.toUpperCase()}: Falling back to simulation`);
      await fetchFromSimulation();
    } else if (!apiSuccess) {
      // No fallback available
      setError(`No ${network} positions available`);
    }

    setIsReady(true);
    setIsLoading(false);
  }, [fetchFromApi, fetchFromSimulation, network, simulationFallback]);

  /**
   * Manual refresh trigger
   */
  const refresh = useCallback(() => {
    void fetchPositions();
  }, [fetchPositions]);

  /**
   * Preload geometries and then set up polling
   *
   * IMPORTANT: Geometry must be preloaded BEFORE fetching positions to ensure
   * vehicles can be snapped to routes. Otherwise, the first update will use
   * raw GPS interpolation (straight lines) instead of following routes.
   */
  useEffect(() => {
    if (!enabled) {
      // Clear timers when disabled
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }

    let cancelled = false;

    async function initializeAndPoll() {
      // Step 1: Preload geometries first (if available and not already loaded)
      if (preloadGeometries && !geometriesLoadedRef.current) {
        try {
          await preloadGeometries();
          geometriesLoadedRef.current = true;
          console.log(`${network.toUpperCase()}: Geometries preloaded for route snapping`);
        } catch (err) {
          console.warn(`Failed to preload ${network} geometries:`, err);
          // Non-fatal - vehicles will use straight-line interpolation instead
        }
      }

      // Check if cancelled during preload
      if (cancelled) return;

      // Step 2: Initial fetch (after geometry is loaded)
      await fetchPositions();

      // Check if cancelled during fetch
      if (cancelled) return;

      // Step 3: Set up polling interval for subsequent updates
      pollingIntervalRef.current = setInterval(() => {
        void fetchPositions();
      }, intervalMs);
    }

    void initializeAndPoll();

    return () => {
      cancelled = true;
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [enabled, intervalMs, fetchPositions, network, preloadGeometries]);

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
