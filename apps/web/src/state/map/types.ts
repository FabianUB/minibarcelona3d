import type { Map as MapboxMap } from 'mapbox-gl';

import type {
  ActivePanel,
  ControlPanelMode,
  MapHighlightMode,
  MapUIState,
  MapViewport,
  TransportType,
} from '../../types/rodalies';

export interface MapState {
  defaultViewport: MapViewport | null;
  viewport: MapViewport | null;
  ui: MapUIState;
  mapInstance: MapboxMap | null;
  isMapLoaded: boolean;
}

export interface MapActions {
  setDefaultViewport(viewport: MapViewport): void;
  setViewport(viewport: MapViewport): void;
  resetViewport(): void;
  selectLine(lineId: string | null, mode?: MapHighlightMode): void;
  toggleLine(lineId: string): void;
  highlightLine(lineId: string): void;
  isolateLine(lineId: string): void;
  clearHighlightedLine(): void;
  setHighContrast(value: boolean): void;
  toggleHighContrast(): void;
  setLegendOpen(value: boolean): void;
  setActivePanel(panel: ActivePanel): void;
  setMapInstance(map: MapboxMap | null): void;
  setMapLoaded(isLoaded: boolean): void;
  selectStation(stationId: string | null): void;
  retryStationLoad(): void;
  setStationLoadError(message: string | null): void;
  setTransportFilter(type: TransportType, visible: boolean): void;
  toggleTransportFilter(type: TransportType): void;
  // Control panel actions
  setNetworkHighlight(network: TransportType, lineId: string, mode: MapHighlightMode): void;
  toggleNetworkLine(network: TransportType, lineId: string): void;
  clearNetworkHighlight(network: TransportType): void;
  setModelSize(network: TransportType, size: number): void;
  setExclusiveNetwork(network: TransportType): void;
  toggleNetworkMulti(network: TransportType): void;
  setActiveControlTab(network: TransportType): void;
  setControlPanelMode(mode: ControlPanelMode): void;
}

export interface MapHighlightSelectors {
  highlightMode: MapHighlightMode;
  highlightedLineId: string | null; // Deprecated: use highlightedLineIds
  highlightedLineIds: string[]; // New: multiple lines can be highlighted
  isAnyLineHighlighted: boolean;
  isLineHighlighted(lineId: string): boolean;
  isLineDimmed(lineId: string): boolean;
}
