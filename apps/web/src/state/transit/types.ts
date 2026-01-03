import type { VehiclePosition } from '../../types/transit';

export interface TransitState {
  selectedVehicle: VehiclePosition | null;
  isPanelOpen: boolean;
}

export interface TransitActions {
  selectVehicle(vehicle: VehiclePosition): void;
  closePanel(): void;
  clearSelection(): void;
}

export type TransitActionType =
  | { type: 'SELECT_VEHICLE'; payload: { vehicle: VehiclePosition } }
  | { type: 'CLOSE_PANEL' }
  | { type: 'CLEAR_SELECTION' };
