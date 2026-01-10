/**
 * MetroStationLayer Component
 * Feature: 006-metro-bus-integration
 *
 * Renders Barcelona Metro station markers as Mapbox GL layers.
 * Uses the unified GenericStopLayer component.
 */

import { useCallback } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { loadMetroStations } from '../../lib/metro/dataLoader';
import { GenericStopLayer, METRO_STOP_CONFIG } from '../transit/GenericStopLayer';

export interface MetroStationLayerProps {
  map: MapboxMap;
  visible?: boolean;
  /** Lines to highlight/isolate (e.g., ['L1', 'L3']) */
  highlightedLines?: string[];
  /** When true, only show stations on highlighted lines */
  isolateMode?: boolean;
  onStationClick?: (stationId: string, stationName: string) => void;
}

export function MetroStationLayer({
  map,
  visible = true,
  highlightedLines = [],
  isolateMode = false,
  onStationClick,
}: MetroStationLayerProps) {
  const loadData = useCallback(() => loadMetroStations(), []);

  return (
    <GenericStopLayer
      map={map}
      loadData={loadData}
      config={METRO_STOP_CONFIG}
      visible={visible}
      highlightedLines={highlightedLines}
      isolateMode={isolateMode}
      onStopClick={onStationClick}
    />
  );
}
