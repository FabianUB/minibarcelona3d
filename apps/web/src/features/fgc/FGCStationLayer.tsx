/**
 * FGCStationLayer Component
 * Feature: 006-metro-bus-integration
 *
 * Renders FGC (Ferrocarrils de la Generalitat de Catalunya) station markers
 * as Mapbox GL layers. Uses the unified GenericStopLayer component.
 */

import { useCallback } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { loadFgcStations } from '../../lib/metro/dataLoader';
import { GenericStopLayer, FGC_STOP_CONFIG } from '../transit/GenericStopLayer';

export interface FGCStationLayerProps {
  map: MapboxMap;
  visible?: boolean;
  /** Lines to highlight/isolate (e.g., ['S1', 'S2']) */
  highlightedLines?: string[];
  /** When true, only show stations on highlighted lines */
  isolateMode?: boolean;
  onStationClick?: (stationId: string, stationName: string) => void;
}

export function FGCStationLayer({
  map,
  visible = true,
  highlightedLines = [],
  isolateMode = false,
  onStationClick,
}: FGCStationLayerProps) {
  const loadData = useCallback(() => loadFgcStations(), []);

  return (
    <GenericStopLayer
      map={map}
      loadData={loadData}
      config={FGC_STOP_CONFIG}
      visible={visible}
      highlightedLines={highlightedLines}
      isolateMode={isolateMode}
      onStopClick={onStationClick}
    />
  );
}
