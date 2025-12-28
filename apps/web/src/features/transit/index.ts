/**
 * Transit feature module
 *
 * Provides 3D visualization for Metro and Bus vehicles.
 */

export { TransitVehicleLayer3D } from './TransitVehicleLayer3D';
export type { TransitVehicleLayer3DProps } from './TransitVehicleLayer3D';

export { useMetroPositions } from './hooks/useMetroPositions';
export type {
  UseMetroPositionsOptions,
  UseMetroPositionsResult,
} from './hooks/useMetroPositions';

export { useBusPositions } from './hooks/useBusPositions';
export type {
  UseBusPositionsOptions,
  UseBusPositionsResult,
} from './hooks/useBusPositions';
