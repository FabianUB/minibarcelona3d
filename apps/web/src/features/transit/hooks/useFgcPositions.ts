/**
 * Hook for generating FGC vehicle positions
 *
 * Generates simulated FGC train positions based on schedule data.
 * Updates positions at regular intervals for smooth animation.
 */

import { useMemo } from 'react';
import {
  generateAllFgcPositions,
  preloadFgcGeometries,
} from '../../../lib/fgc/positionSimulator';
import { FGC_SIMULATION_INTERVAL_MS } from '../../../config/fgcConfig';
import {
  useTransitPositions,
  type UseTransitPositionsOptions,
  type UseTransitPositionsResult,
} from './useTransitPositions';

export type UseFgcPositionsOptions = UseTransitPositionsOptions;
export type UseFgcPositionsResult = UseTransitPositionsResult;

/**
 * Hook to generate simulated FGC vehicle positions
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
  const config = useMemo(() => ({
    name: 'FGC',
    defaultIntervalMs: FGC_SIMULATION_INTERVAL_MS,
    preloadGeometries: preloadFgcGeometries,
    generatePositions: generateAllFgcPositions,
  }), []);

  return useTransitPositions(config, options);
}
