import { describe, it, expect } from 'vitest';
import { DEFAULT_NETWORK, createExclusiveFilters } from '../MapStateProvider';

describe('Transport defaults alignment', () => {
  it('DEFAULT_NETWORK should be enabled in default transport filters', () => {
    const filters = createExclusiveFilters(DEFAULT_NETWORK);
    expect(filters[DEFAULT_NETWORK]).toBe(true);
  });

  it('createExclusiveFilters should enable only the specified network', () => {
    const filters = createExclusiveFilters(DEFAULT_NETWORK);
    const enabledNetworks = Object.entries(filters)
      .filter(([_, enabled]) => enabled)
      .map(([network]) => network);

    expect(enabledNetworks).toHaveLength(1);
    expect(enabledNetworks[0]).toBe(DEFAULT_NETWORK);
  });

  it('createExclusiveFilters should work for all network types', () => {
    const networks = ['rodalies', 'metro', 'bus', 'tram', 'fgc'] as const;

    for (const network of networks) {
      const filters = createExclusiveFilters(network);

      // Only this network should be enabled
      expect(filters[network]).toBe(true);

      // All others should be disabled
      const othersDisabled = networks
        .filter(n => n !== network)
        .every(n => filters[n] === false);
      expect(othersDisabled).toBe(true);
    }
  });
});
