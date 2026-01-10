/**
 * TramLineLayer Component
 * Feature: 006-metro-bus-integration
 *
 * Renders Barcelona TRAM line geometries as Mapbox GL layers.
 * Uses the unified GenericLineLayer component.
 */

import { useCallback } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { loadAllTramLines } from '../../lib/metro/dataLoader';
import { GenericLineLayer } from '../transit/GenericLineLayer';
import { TRAM_LINE_CONFIG } from '../transit/lineLayerConfig';

export interface TramLineLayerProps {
  map: MapboxMap;
  visible?: boolean;
  /** Optional: highlight specific line codes (e.g., ['T1', 'T2']) */
  highlightedLines?: string[];
  /** Optional: isolate mode dims non-highlighted lines */
  isolateMode?: boolean;
}

export function TramLineLayer({
  map,
  visible = true,
  highlightedLines = [],
  isolateMode = false,
}: TramLineLayerProps) {
  const loadData = useCallback(() => loadAllTramLines(), []);

  return (
    <GenericLineLayer
      map={map}
      loadData={loadData}
      config={TRAM_LINE_CONFIG}
      visible={visible}
      highlightedLines={highlightedLines}
      isolateMode={isolateMode}
    />
  );
}
