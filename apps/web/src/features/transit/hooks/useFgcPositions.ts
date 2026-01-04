/**
 * Hook for fetching FGC vehicle positions
 *
 * Fetches pre-calculated FGC positions from the backend API.
 * Falls back to client-side simulation if API is unavailable.
 * Updates positions every 30 seconds to match backend polling.
 */

import {
  generateAllFgcPositions,
  preloadFgcGeometries,
} from '../../../lib/fgc/positionSimulator';
import {
  useSchedulePositions,
  type UseSchedulePositionsOptions,
  type UseSchedulePositionsResult,
} from './useSchedulePositions';

export type UseFgcPositionsOptions = Omit<UseSchedulePositionsOptions, 'network' | 'simulationFallback' | 'preloadGeometries'>;
export type UseFgcPositionsResult = UseSchedulePositionsResult;

/**
 * Hook to fetch FGC vehicle positions from API
 *
 * Uses pre-calculated schedule-based positions from the backend.
 * Falls back to client-side simulation if API fails.
 *
 * @param options - Configuration options
 * @returns Position data and status
 *
 * @example
 * const { positions, isReady, isLoading } = useFgcPositions({ enabled: true });
 */
export function useFgcPositions(
  options: UseFgcPositionsOptions = {}
): UseFgcPositionsResult {
  return useSchedulePositions({
    ...options,
    network: 'fgc',
    simulationFallback: generateAllFgcPositions,
    preloadGeometries: preloadFgcGeometries,
  });
}
