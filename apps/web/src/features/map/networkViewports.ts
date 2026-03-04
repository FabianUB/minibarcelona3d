import type { TransportType } from '../../types/rodalies';

/**
 * Check whether a network's preset destination is already visible on screen.
 * Uses center + zoom to estimate the viewport (immune to 3D pitch inflation
 * from map.getBounds()).  If the fly-to target is already on screen, there is
 * no point in flying.
 */
export function isPresetVisibleInViewport(
  mapCenter: { lng: number; lat: number },
  zoom: number,
  presetCenter: [lng: number, lat: number],
): boolean {
  // At zoom Z a 256px tile covers 360/2^Z degrees of longitude.
  // A ~1920px-wide screen ≈ 7.5 tiles → half-span ≈ 3.75 × tileSpan.
  const lngHalfSpan = (360 / Math.pow(2, zoom)) * 3.75;
  const latHalfSpan = lngHalfSpan * 0.75;

  const [pLng, pLat] = presetCenter;
  return (
    pLng >= mapCenter.lng - lngHalfSpan &&
    pLng <= mapCenter.lng + lngHalfSpan &&
    pLat >= mapCenter.lat - latHalfSpan &&
    pLat <= mapCenter.lat + latHalfSpan
  );
}

export interface CameraPreset {
  center: [number, number]; // [lng, lat]
  zoom: number;
  pitch: number;
  bearing: number;
  scaleBoost: number; // vehicle model scale multiplier for this zoom level
}

export interface NetworkViewConfig {
  birdsEye: CameraPreset;
  free3D: CameraPreset;
}

// free3D zoom is tuned per network density:
//   Dense (metro, bus) → higher zoom so nearby vehicles don't overlap
//   Sparse (rodalies)  → wider zoom to see the spread-out network
// scaleBoost is global (applied to all layers), but changes on each tab switch,
// so it's tuned for the active tab's zoom level and vehicle density.
export const NETWORK_VIEWPORTS: Record<TransportType, NetworkViewConfig> = {
  rodalies: {
    birdsEye: { center: [2.13752, 41.39388], zoom: 11.29, pitch: 30, bearing: 0, scaleBoost: 2.7 },
    free3D:   { center: [2.14, 41.39], zoom: 13, pitch: 60, bearing: 0, scaleBoost: 2.5 },
  },
  metro: {
    birdsEye: { center: [2.148353, 41.403243], zoom: 11.85, pitch: 30.12, bearing: 0, scaleBoost: 1.7 },
    free3D:   { center: [2.15, 41.39], zoom: 14, pitch: 60, bearing: 0, scaleBoost: 2.0 },
  },
  bus: {
    birdsEye: { center: [2.142187, 41.402268], zoom: 11.99, pitch: 30, bearing: 0, scaleBoost: 2.7 },
    free3D:   { center: [2.15, 41.39], zoom: 14, pitch: 60, bearing: 0, scaleBoost: 2.0 },
  },
  tram: {
    birdsEye: { center: [2.133049, 41.398334], zoom: 11.93, pitch: 30, bearing: 0, scaleBoost: 3.5 },
    free3D:   { center: [2.10, 41.38], zoom: 14, pitch: 60, bearing: 0, scaleBoost: 3.5 },
  },
  fgc: {
    birdsEye: { center: [2.099357, 41.428941], zoom: 11.69, pitch: 30, bearing: 0, scaleBoost: 3.0 },
    free3D:   { center: [2.12, 41.40], zoom: 14, pitch: 60, bearing: 0, scaleBoost: 2.5 },
  },
};
