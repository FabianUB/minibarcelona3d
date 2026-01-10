/**
 * FGCLineLayer Component
 * Feature: 006-metro-bus-integration
 *
 * Renders FGC (Ferrocarrils de la Generalitat de Catalunya) line geometries
 * as Mapbox GL layers. Uses the unified GenericLineLayer component.
 */

import { useCallback } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { loadAllFgcLines } from '../../lib/metro/dataLoader';
import { GenericLineLayer, FGC_LINE_CONFIG } from '../transit/GenericLineLayer';

export interface FGCLineLayerProps {
  map: MapboxMap;
  visible?: boolean;
  /** Optional: highlight specific line codes (e.g., ['S1', 'S2', 'L6']) */
  highlightedLines?: string[];
  /** Optional: isolate mode dims non-highlighted lines */
  isolateMode?: boolean;
}

export function FGCLineLayer({
  map,
  visible = true,
  highlightedLines = [],
  isolateMode = false,
}: FGCLineLayerProps) {
  const loadData = useCallback(() => loadAllFgcLines(), []);

  return (
    <GenericLineLayer
      map={map}
      loadData={loadData}
      config={FGC_LINE_CONFIG}
      visible={visible}
      highlightedLines={highlightedLines}
      isolateMode={isolateMode}
    />
  );
}
