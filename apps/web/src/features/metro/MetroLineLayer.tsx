/**
 * MetroLineLayer Component
 * Feature: 006-metro-bus-integration
 *
 * Renders Barcelona Metro line geometries as Mapbox GL layers.
 * Uses the unified GenericLineLayer component.
 */

import { useCallback } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { loadAllMetroLines } from '../../lib/metro/dataLoader';
import { GenericLineLayer } from '../transit/GenericLineLayer';
import { METRO_LINE_CONFIG } from '../transit/lineLayerConfig';

export interface MetroLineLayerProps {
  map: MapboxMap;
  visible?: boolean;
  /** Optional: highlight specific line codes (e.g., ['L1', 'L3']) */
  highlightedLines?: string[];
  /** Optional: isolate mode dims non-highlighted lines */
  isolateMode?: boolean;
}

export function MetroLineLayer({
  map,
  visible = true,
  highlightedLines = [],
  isolateMode = false,
}: MetroLineLayerProps) {
  const loadData = useCallback(() => loadAllMetroLines(), []);

  return (
    <GenericLineLayer
      map={map}
      loadData={loadData}
      config={METRO_LINE_CONFIG}
      visible={visible}
      highlightedLines={highlightedLines}
      isolateMode={isolateMode}
    />
  );
}
