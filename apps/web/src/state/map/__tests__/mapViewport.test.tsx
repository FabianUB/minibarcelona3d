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
  it('resets the map to the default viewport after pan/zoom', () => {
    const fakeMap = {
      jumpTo: vi.fn(),
      setPadding: vi.fn(),
      setMaxBounds: vi.fn(),
    } as unknown as mapboxgl.Map;

    const wrapper = ({ children }: PropsWithChildren) => (
      <MapStateProvider>{children}</MapStateProvider>
    );

    const { result } = renderHook(() => useMapStore(), { wrapper });
    const [, actions] = result.current;

    act(() => {
      actions.setDefaultViewport(DEFAULT_VIEWPORT);
    });

    act(() => {
      actions.setMapInstance(fakeMap);
    });

    act(() => {
      actions.setViewport({
        ...DEFAULT_VIEWPORT,
        center: { lat: 41.5, lng: 2.3 },
        zoom: 11,
      });
    });

    act(() => {
      actions.resetViewport();
    });

    const [stateAfterReset] = result.current;
    expect(stateAfterReset.viewport).toEqual(DEFAULT_VIEWPORT);
    expect(fakeMap.setMaxBounds).toHaveBeenCalledWith(DEFAULT_VIEWPORT.max_bounds);
    expect(fakeMap.setPadding).toHaveBeenCalledWith(DEFAULT_VIEWPORT.padding);
    expect(fakeMap.jumpTo).toHaveBeenCalledWith({
      center: [DEFAULT_VIEWPORT.center.lng, DEFAULT_VIEWPORT.center.lat],
      zoom: DEFAULT_VIEWPORT.zoom,
    });
  });
});
