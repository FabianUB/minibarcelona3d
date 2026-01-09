/**
 * Hook for fetching Bus vehicle positions
 *
 * Fetches pre-calculated Bus positions from the backend API.
 * Falls back to client-side simulation if API is unavailable.
 * Updates positions every 30 seconds to match backend polling.
 */

import { useMemo } from 'react';
import {
  generateAllBusPositions,
  preloadBusGeometries,
} from '../../../lib/bus/positionSimulator';
import { TOP_BUS_LINES, isTopBusLine } from '../../../config/busConfig';
import {
  useSchedulePositions,
  type UseSchedulePositionsOptions,
  type UseSchedulePositionsResult,
} from './useSchedulePositions';

export type UseBusPositionsOptions = Omit<UseSchedulePositionsOptions, 'network' | 'simulationFallback' | 'preloadGeometries'> & {
  /** When true, only return positions for top 10 most used bus lines (default: false) */
  filterTopLinesOnly?: boolean;
};

export type UseBusPositionsResult = UseSchedulePositionsResult & {
  /** All positions before filtering (for counting) */
  allPositionsCount: number;
};

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
 *
 * // With top lines filter
 * const { positions } = useBusPositions({ enabled: true, filterTopLinesOnly: true });
 */
export function useBusPositions(
  options: UseBusPositionsOptions = {}
): UseBusPositionsResult {
  const { filterTopLinesOnly = false, ...scheduleOptions } = options;

  const result = useSchedulePositions({
    ...scheduleOptions,
    network: 'bus',
    simulationFallback: generateAllBusPositions,
    preloadGeometries: preloadBusGeometries,
  });

  // Filter positions to only include top bus lines if enabled
  const filteredPositions = useMemo(() => {
    if (!filterTopLinesOnly) {
      return result.positions;
    }
    return result.positions.filter((pos) => {
      // Extract route code from routeId or lineCode
      const routeCode = pos.lineCode || pos.routeId?.split('-').pop() || '';
      return isTopBusLine(routeCode);
    });
  }, [result.positions, filterTopLinesOnly]);

  return {
    ...result,
    positions: filteredPositions,
    vehicleCount: filteredPositions.length,
    allPositionsCount: result.positions.length,
  };
}

/**
 * Get list of top bus line codes for display
 */
export { TOP_BUS_LINES };
