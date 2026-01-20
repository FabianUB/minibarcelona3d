import type { TransportFilterState, TransportType } from '../../types/rodalies';

/**
 * Single source of truth for the default network.
 * Both transport filters and active tab derive from this value.
 */
export const DEFAULT_NETWORK: TransportType = 'metro';

/**
 * Creates transport filter state with only the specified network enabled.
 * Used for both default state and exclusive network selection.
 */
export function createExclusiveFilters(network: TransportType): TransportFilterState {
  return {
    rodalies: network === 'rodalies',
    metro: network === 'metro',
    bus: network === 'bus',
    tram: network === 'tram',
    fgc: network === 'fgc',
  };
}
