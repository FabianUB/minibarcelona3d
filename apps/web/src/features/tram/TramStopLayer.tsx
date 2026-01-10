/**
 * TramStopLayer Component
 * Feature: 006-metro-bus-integration
 *
 * Renders Barcelona TRAM stop markers as Mapbox GL layers.
 * Uses the unified GenericStopLayer component.
 */

import { useCallback } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { loadTramStops } from '../../lib/metro/dataLoader';
import { GenericStopLayer, TRAM_STOP_CONFIG } from '../transit/GenericStopLayer';

export interface TramStopLayerProps {
  map: MapboxMap;
  visible?: boolean;
  /** Lines to highlight/isolate (e.g., ['T1', 'T2']) */
  highlightedLines?: string[];
  /** When true, only show stops on highlighted lines */
  isolateMode?: boolean;
  onStopClick?: (stopId: string, stopName: string) => void;
}

export function TramStopLayer({
  map,
  visible = true,
  highlightedLines = [],
  isolateMode = false,
  onStopClick,
}: TramStopLayerProps) {
  const loadData = useCallback(() => loadTramStops(), []);

  return (
    <GenericStopLayer
      map={map}
      loadData={loadData}
      config={TRAM_STOP_CONFIG}
      visible={visible}
      highlightedLines={highlightedLines}
      isolateMode={isolateMode}
      onStopClick={onStopClick}
    />
  );
}
