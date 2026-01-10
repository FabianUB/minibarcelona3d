/**
 * BusLineLayer Component
 * Feature: 006-metro-bus-integration
 *
 * Renders Barcelona Bus route geometries as Mapbox GL layers.
 * Uses the unified GenericLineLayer component.
 */

import { useCallback, useMemo } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { loadAllBusRoutes } from '../../lib/metro/dataLoader';
import type { MetroLineCollection } from '../../types/metro';
import { isTopBusLine } from '../../config/busConfig';
import { GenericLineLayer } from '../transit/GenericLineLayer';
import { BUS_LINE_CONFIG } from '../transit/lineLayerConfig';

export interface BusLineLayerProps {
  map: MapboxMap;
  visible?: boolean;
  /** Optional: highlight specific route codes */
  highlightedRoutes?: string[];
  /** Optional: isolate mode dims non-highlighted routes */
  isolateMode?: boolean;
  /** Optional: only show top 10 most used bus lines */
  filterTopLinesOnly?: boolean;
}

export function BusLineLayer({
  map,
  visible = true,
  highlightedRoutes = [],
  isolateMode = false,
  filterTopLinesOnly = false,
}: BusLineLayerProps) {
  const loadData = useCallback(() => loadAllBusRoutes(), []);

  // Filter function for top bus lines
  const filterFeatures = useMemo(() => {
    if (!filterTopLinesOnly) return undefined;

    return (features: MetroLineCollection['features']) =>
      features.filter((feature) => {
        const props = feature.properties as { route_code?: string } | null;
        const routeCode = props?.route_code;
        return routeCode && isTopBusLine(routeCode);
      });
  }, [filterTopLinesOnly]);

  return (
    <GenericLineLayer
      map={map}
      loadData={loadData}
      config={BUS_LINE_CONFIG}
      visible={visible}
      highlightedLines={highlightedRoutes}
      isolateMode={isolateMode}
      filterFeatures={filterFeatures}
    />
  );
}
