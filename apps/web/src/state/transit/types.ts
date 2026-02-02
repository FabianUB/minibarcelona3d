import type { VehiclePosition } from '../../types/transit';
import type { TransportType } from '../../types/rodalies';

/**
 * Data source type for each network
 * - 'realtime': Real-time data from API (GPS or arrival predictions)
 * - 'schedule': Schedule-based simulation (fallback when real-time unavailable)
 * - 'unavailable': No data available (API down, no fallback possible)
 * - 'unknown': Not yet determined
 */
export type DataSourceType = 'realtime' | 'schedule' | 'unavailable' | 'unknown';

/**
 * Data source status for all transit networks
 */
export type DataSourceStatus = Record<TransportType, DataSourceType>;

export interface TransitState {
  selectedVehicle: VehiclePosition | null;
  isPanelOpen: boolean;
  /** Data source status for each transit network */
  dataSourceStatus: DataSourceStatus;
}

export interface TransitActions {
  selectVehicle(vehicle: VehiclePosition): void;
  closePanel(): void;
  clearSelection(): void;
  /** Update the data source status for a network */
  setDataSource(network: TransportType, source: DataSourceType): void;
}

export type TransitActionType =
  | { type: 'SELECT_VEHICLE'; payload: { vehicle: VehiclePosition } }
  | { type: 'CLOSE_PANEL' }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SET_DATA_SOURCE'; payload: { network: TransportType; source: DataSourceType } };
