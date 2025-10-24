// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MapStateProvider } from '../MapStateProvider';
import { useMapStore } from '../useMapStore';
import type { MapViewport } from '../../../types/rodalies';

const DEFAULT_VIEWPORT: MapViewport = {
  center: { lat: 41.3851, lng: 2.1734 },
  zoom: 9,
  max_bounds: [
    [1.4, 40.3],
    [3.6, 42.6],
  ],
  padding: { top: 48, right: 48, bottom: 64, left: 48 },
};

describe('MapState viewport management', () => {
  it('resets the map state to the default viewport after pan/zoom', () => {
    const wrapper = ({ children }: PropsWithChildren) => (
      <MapStateProvider>{children}</MapStateProvider>
    );

    const { result } = renderHook(() => useMapStore(), { wrapper });
    const [, actions] = result.current;

    // Set default viewport
    act(() => {
      actions.setDefaultViewport(DEFAULT_VIEWPORT);
    });

    // Simulate user panning/zooming the map
    act(() => {
      actions.setViewport({
        ...DEFAULT_VIEWPORT,
        center: { lat: 41.5, lng: 2.3 },
        zoom: 11,
      });
    });

    // Verify viewport was changed
    let [state] = result.current;
    expect(state.viewport.center).toEqual({ lat: 41.5, lng: 2.3 });
    expect(state.viewport.zoom).toBe(11);

    // Reset viewport
    act(() => {
      actions.resetViewport();
    });

    // Verify viewport was reset to default
    [state] = result.current;
    expect(state.viewport).toEqual(DEFAULT_VIEWPORT);
    expect(state.viewport.center).toEqual(DEFAULT_VIEWPORT.center);
    expect(state.viewport.zoom).toBe(DEFAULT_VIEWPORT.zoom);
  });
});
