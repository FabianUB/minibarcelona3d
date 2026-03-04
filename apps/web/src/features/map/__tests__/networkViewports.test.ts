import { describe, it, expect } from 'vitest';
import { isPresetVisibleInViewport, NETWORK_VIEWPORTS } from '../networkViewports';

describe('isPresetVisibleInViewport', () => {
  it('returns true when preset center is at the map center', () => {
    expect(isPresetVisibleInViewport({ lng: 2.08, lat: 41.387 }, 15, [2.08, 41.387])).toBe(true);
  });

  it('returns true when preset is near the map center within viewport', () => {
    expect(isPresetVisibleInViewport({ lng: 2.09, lat: 41.39 }, 15, [2.08, 41.387])).toBe(true);
  });

  it('returns false when preset is far east of viewport at high zoom', () => {
    expect(isPresetVisibleInViewport({ lng: 2.30, lat: 41.40 }, 15, [2.08, 41.387])).toBe(false);
  });

  it('returns false when preset is far west of viewport', () => {
    expect(isPresetVisibleInViewport({ lng: 1.80, lat: 41.40 }, 15, [2.08, 41.387])).toBe(false);
  });

  it('returns false when preset is far north of viewport', () => {
    expect(isPresetVisibleInViewport({ lng: 2.08, lat: 41.60 }, 15, [2.08, 41.387])).toBe(false);
  });

  it('returns false when preset is far south of viewport', () => {
    expect(isPresetVisibleInViewport({ lng: 2.08, lat: 41.10 }, 15, [2.08, 41.387])).toBe(false);
  });

  it('is more generous at low zoom (bird\'s eye)', () => {
    // At zoom 11, the viewport is much wider — preset 0.3° away should be visible
    expect(isPresetVisibleInViewport({ lng: 2.15, lat: 41.40 }, 11, [2.45, 41.40])).toBe(true);
  });

  it('is strict at high zoom (free 3D)', () => {
    // Same 0.3° offset is NOT visible at zoom 15
    expect(isPresetVisibleInViewport({ lng: 2.15, lat: 41.40 }, 15, [2.45, 41.40])).toBe(false);
  });
});

describe('isPresetVisibleInViewport — real network scenarios', () => {
  it('tram NOT visible when panned to east Barcelona in 3D', () => {
    // User panned to Badalona area at zoom 13, tram preset is out of view
    const tramPreset = NETWORK_VIEWPORTS.tram.free3D.center;
    expect(
      isPresetVisibleInViewport({ lng: 2.35, lat: 41.45 }, 13, tramPreset),
    ).toBe(false);
  });

  it('tram visible when already at tram area in 3D', () => {
    const tramPreset = NETWORK_VIEWPORTS.tram.free3D;
    expect(
      isPresetVisibleInViewport({ lng: 2.105, lat: 41.385 }, tramPreset.zoom, tramPreset.center),
    ).toBe(true);
  });

  it('all Barcelona networks visible from bird\'s eye centered on Barcelona', () => {
    const birdCenter = { lng: 2.15, lat: 41.40 };
    const zoom = 11.5;
    for (const network of ['rodalies', 'metro', 'bus', 'tram', 'fgc'] as const) {
      const preset = NETWORK_VIEWPORTS[network].birdsEye.center;
      expect(isPresetVisibleInViewport(birdCenter, zoom, preset)).toBe(true);
    }
  });

  it('networks NOT visible when panned far away', () => {
    const farAway = { lng: 0.5, lat: 40.0 };
    for (const network of ['rodalies', 'metro', 'bus', 'tram', 'fgc'] as const) {
      const preset = NETWORK_VIEWPORTS[network].birdsEye.center;
      expect(isPresetVisibleInViewport(farAway, 11, preset)).toBe(false);
    }
  });
});
