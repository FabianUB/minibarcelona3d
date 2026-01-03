/**
 * Hook for generating Bus vehicle positions
 *
 * Generates simulated Bus positions based on schedule data.
 * Updates positions at regular intervals for smooth animation.
 */

import { useMemo } from 'react';
import {
  generateAllBusPositions,
  preloadBusGeometries,
} from '../../../lib/bus/positionSimulator';
import { BUS_SIMULATION_INTERVAL_MS } from '../../../config/busConfig';
import {
  useTransitPositions,
  type UseTransitPositionsOptions,
  type UseTransitPositionsResult,
} from './useTransitPositions';

export type UseBusPositionsOptions = UseTransitPositionsOptions;
export type UseBusPositionsResult = UseTransitPositionsResult;

/**
 * Hook to generate simulated Bus vehicle positions
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
  const config = useMemo(() => ({
    name: 'Bus',
    defaultIntervalMs: BUS_SIMULATION_INTERVAL_MS,
    preloadGeometries: preloadBusGeometries,
    generatePositions: generateAllBusPositions,
  }), []);

  return useTransitPositions(config, options);
}
