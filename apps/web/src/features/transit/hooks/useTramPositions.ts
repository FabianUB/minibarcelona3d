/**
 * Hook for generating TRAM vehicle positions
 *
 * Generates simulated TRAM positions based on schedule data.
 * Updates positions at regular intervals for smooth animation.
 */

import { useMemo } from 'react';
import {
  generateAllTramPositions,
  preloadTramGeometries,
} from '../../../lib/tram/positionSimulator';
import { TRAM_SIMULATION_INTERVAL_MS } from '../../../config/tramConfig';
import {
  useTransitPositions,
  type UseTransitPositionsOptions,
  type UseTransitPositionsResult,
} from './useTransitPositions';

export type UseTramPositionsOptions = UseTransitPositionsOptions;
export type UseTramPositionsResult = UseTransitPositionsResult;

/**
 * Hook to generate simulated TRAM vehicle positions
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
  const config = useMemo(() => ({
    name: 'TRAM',
    defaultIntervalMs: TRAM_SIMULATION_INTERVAL_MS,
    preloadGeometries: preloadTramGeometries,
    generatePositions: generateAllTramPositions,
  }), []);

  return useTransitPositions(config, options);
}
