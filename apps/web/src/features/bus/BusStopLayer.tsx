/**
 * BusStopLayer Component
 * Feature: 006-metro-bus-integration
 *
 * Renders Barcelona Bus stop markers as Mapbox GL layers.
 * Uses the unified GenericStopLayer component.
 */

import { useCallback, useMemo } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { loadBusStops } from '../../lib/metro/dataLoader';
import { GenericStopLayer } from '../transit/GenericStopLayer';
import { BUS_STOP_CONFIG } from '../transit/stopLayerConfig';
import { TOP_BUS_LINES } from '../../config/busConfig';

export interface BusStopLayerProps {
  map: MapboxMap;
  visible?: boolean;
  /** Routes to highlight/isolate (e.g., ['H10', 'V15']) */
  highlightedRoutes?: string[];
  /** When true, only show stops on highlighted routes */
  isolateMode?: boolean;
  /** When true, only show stops served by top 10 bus lines */
  filterTopLinesOnly?: boolean;
  onStopClick?: (stopId: string, stopName: string) => void;
}

export function BusStopLayer({
  map,
  visible = true,
  highlightedRoutes = [],
  isolateMode = false,
  filterTopLinesOnly = false,
  onStopClick,
}: BusStopLayerProps) {
  const loadData = useCallback(() => loadBusStops(), []);

  // When filtering by top lines only, use TOP_BUS_LINES as the filter
  // If specific routes are highlighted, those take precedence
  const effectiveHighlightedLines = useMemo(() => {
    if (highlightedRoutes.length > 0) {
      return highlightedRoutes;
    }
    if (filterTopLinesOnly) {
      return [...TOP_BUS_LINES];
    }
    return [];
  }, [highlightedRoutes, filterTopLinesOnly]);

  // Enable isolate mode when filtering by top lines (to hide non-top-line stops)
  const effectiveIsolateMode = isolateMode || (filterTopLinesOnly && highlightedRoutes.length === 0);

  return (
    <GenericStopLayer
      map={map}
      loadData={loadData}
      config={BUS_STOP_CONFIG}
      visible={visible}
      highlightedLines={effectiveHighlightedLines}
      isolateMode={effectiveIsolateMode}
      onStopClick={onStopClick}
    />
  );
}
