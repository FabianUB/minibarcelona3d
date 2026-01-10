/**
 * BusStopLayer Component
 * Feature: 006-metro-bus-integration
 *
 * Renders Barcelona Bus stop markers as Mapbox GL layers.
 * Uses the unified GenericStopLayer component.
 */

import { useCallback } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { loadBusStops } from '../../lib/metro/dataLoader';
import { GenericStopLayer, BUS_STOP_CONFIG } from '../transit/GenericStopLayer';

export interface BusStopLayerProps {
  map: MapboxMap;
  visible?: boolean;
  /** Routes to highlight/isolate (e.g., ['H10', 'V15']) */
  highlightedRoutes?: string[];
  /** When true, only show stops on highlighted routes */
  isolateMode?: boolean;
  onStopClick?: (stopId: string, stopName: string) => void;
}

export function BusStopLayer({
  map,
  visible = true,
  highlightedRoutes = [],
  isolateMode = false,
  onStopClick,
}: BusStopLayerProps) {
  const loadData = useCallback(() => loadBusStops(), []);

  return (
    <GenericStopLayer
      map={map}
      loadData={loadData}
      config={BUS_STOP_CONFIG}
      visible={visible}
      highlightedLines={highlightedRoutes}
      isolateMode={isolateMode}
      onStopClick={onStopClick}
    />
  );
}
