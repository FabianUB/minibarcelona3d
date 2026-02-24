import type { TransportType } from '../../types/rodalies';

export interface CameraPreset {
  center: [number, number]; // [lng, lat]
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface BirdsEyePreset extends CameraPreset {
  scaleBoost: number; // vehicle model scale multiplier for this zoom level
}

export interface NetworkViewConfig {
  birdsEye: BirdsEyePreset;
  free3D: CameraPreset;
}

export const NETWORK_VIEWPORTS: Record<TransportType, NetworkViewConfig> = {
  rodalies: {
    birdsEye: { center: [2.13752, 41.39388], zoom: 11.29, pitch: 30, bearing: 0, scaleBoost: 7.0 },
    free3D:   { center: [2.14, 41.38], zoom: 15.5, pitch: 60, bearing: 0 },
  },
  metro: {
    birdsEye: { center: [2.148353, 41.403243], zoom: 11.85, pitch: 30.12, bearing: 0, scaleBoost: 3.5 },
    free3D:   { center: [2.165, 41.393], zoom: 15.5, pitch: 60, bearing: 0 },
  },
  bus: {
    birdsEye: { center: [2.142187, 41.402268], zoom: 11.99, pitch: 30, bearing: 0, scaleBoost: 5.5 },
    free3D:   { center: [2.170, 41.387], zoom: 15.5, pitch: 60, bearing: 0 },
  },
  tram: {
    birdsEye: { center: [2.133049, 41.398334], zoom: 11.93, pitch: 30, bearing: 0, scaleBoost: 7.0 },
    free3D:   { center: [2.08, 41.387], zoom: 15, pitch: 60, bearing: 0 },
  },
  fgc: {
    birdsEye: { center: [2.099357, 41.428941], zoom: 11.69, pitch: 30, bearing: 0, scaleBoost: 7.0 },
    free3D:   { center: [2.148, 41.375], zoom: 15.5, pitch: 60, bearing: 0 },
  },
};
