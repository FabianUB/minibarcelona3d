import type { Map as MapboxMap } from 'mapbox-gl';

import type {
  ActivePanel,
  ControlPanelMode,
  MapViewport,
  ModelSizeMap,
  NetworkHighlightMap,
  TransportFilterState,
  TransportType,
} from '../../types/rodalies';

export interface MapCoreState {
  defaultViewport: MapViewport | null;
  viewport: MapViewport | null;
  mapInstance: MapboxMap | null;
  isMapLoaded: boolean;
}

export interface MapUIContextState {
  activePanel: ActivePanel;
  isHighContrast: boolean;
  isLegendOpen: boolean;
  showStations: boolean;
  enableTrainParking: boolean;
  selectedStationId: string | null;
  stationLoadError: string | null;
}

export interface MapNetworkContextState {
  transportFilters: TransportFilterState;
  modelSizes: ModelSizeMap;
  activeControlTab: TransportType;
  controlPanelMode: ControlPanelMode;
  networkHighlights: NetworkHighlightMap;
  showOnlyTopBusLines: boolean;
}
