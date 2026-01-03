/**
 * Transit feature module
 *
 * Provides 3D visualization for Metro, Bus, TRAM, and FGC vehicles.
 */

export { TransitVehicleLayer3D } from './TransitVehicleLayer3D';
export type { TransitVehicleLayer3DProps } from './TransitVehicleLayer3D';

export { TransitInfoPanel } from './TransitInfoPanel';

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

export { useTramPositions } from './hooks/useTramPositions';
export type {
  UseTramPositionsOptions,
  UseTramPositionsResult,
} from './hooks/useTramPositions';

export { useFgcPositions } from './hooks/useFgcPositions';
export type {
  UseFgcPositionsOptions,
  UseFgcPositionsResult,
} from './hooks/useFgcPositions';
