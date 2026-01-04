/**
 * Hook for fetching TRAM vehicle positions
 *
 * Fetches pre-calculated TRAM positions from the backend API.
 * Falls back to client-side simulation if API is unavailable.
 * Updates positions every 30 seconds to match backend polling.
 */

import {
  generateAllTramPositions,
  preloadTramGeometries,
} from '../../../lib/tram/positionSimulator';
import {
  useSchedulePositions,
  type UseSchedulePositionsOptions,
  type UseSchedulePositionsResult,
} from './useSchedulePositions';

export type UseTramPositionsOptions = Omit<UseSchedulePositionsOptions, 'network' | 'simulationFallback' | 'preloadGeometries'>;
export type UseTramPositionsResult = UseSchedulePositionsResult;

/**
 * Hook to fetch TRAM vehicle positions from API
 *
 * Uses pre-calculated schedule-based positions from the backend.
 * Falls back to client-side simulation if API fails.
 *
 * @param options - Configuration options
 * @returns Position data and status
 *
 * @example
 * const { positions, isReady, isLoading } = useTramPositions({ enabled: true });
 */
export function useTramPositions(
  options: UseTramPositionsOptions = {}
): UseTramPositionsResult {
  return useSchedulePositions({
    ...options,
    network: 'tram',
    simulationFallback: generateAllTramPositions,
    preloadGeometries: preloadTramGeometries,
  });
}
