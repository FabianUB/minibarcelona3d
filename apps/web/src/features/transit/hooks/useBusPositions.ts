/**
 * Hook for fetching Bus vehicle positions
 *
 * Fetches pre-calculated Bus positions from the backend API.
 * Falls back to client-side simulation if API is unavailable.
 * Updates positions every 30 seconds to match backend polling.
 */

import {
  generateAllBusPositions,
  preloadBusGeometries,
} from '../../../lib/bus/positionSimulator';
import {
  useSchedulePositions,
  type UseSchedulePositionsOptions,
  type UseSchedulePositionsResult,
} from './useSchedulePositions';

export type UseBusPositionsOptions = Omit<UseSchedulePositionsOptions, 'network' | 'simulationFallback' | 'preloadGeometries'>;
export type UseBusPositionsResult = UseSchedulePositionsResult;

/**
 * Hook to fetch Bus vehicle positions from API
 *
 * Uses pre-calculated schedule-based positions from the backend.
 * Falls back to client-side simulation if API fails.
 *
 * @param options - Configuration options
 * @returns Position data and status
 *
 * @example
 * const { positions, isReady, isLoading } = useBusPositions({ enabled: true });
 */
export function useBusPositions(
  options: UseBusPositionsOptions = {}
): UseBusPositionsResult {
  return useSchedulePositions({
    ...options,
    network: 'bus',
    simulationFallback: generateAllBusPositions,
    preloadGeometries: preloadBusGeometries,
  });
}
