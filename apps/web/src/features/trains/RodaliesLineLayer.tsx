/**
 * RodaliesLineLayer Component
 *
 * Renders Rodalies (commuter rail) line geometries as Mapbox GL layers.
 * Uses the unified GenericLineLayer component for consistency with other networks.
 *
 * Previously, Rodalies lines were initialized inline in MapCanvas during handleLoad,
 * which caused timing differences compared to other networks that use React components.
 * This component aligns Rodalies with Metro/Bus/Tram/FGC architecture.
 */

import { useCallback } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { loadLineGeometryCollection } from '../../lib/rodalies/dataLoader';
import { GenericLineLayer } from '../transit/GenericLineLayer';
import { RODALIES_LINE_CONFIG } from '../transit/lineLayerConfig';
import type { LineGeometryCollection } from '../../types/rodalies';
import type { MetroLineCollection } from '../../types/metro';

export interface RodaliesLineLayerProps {
  map: MapboxMap;
  visible?: boolean;
  /** Optional: highlight specific line codes (e.g., ['R1', 'R3']) */
  highlightedLines?: string[];
  /** Optional: isolate mode dims non-highlighted lines */
  isolateMode?: boolean;
}

/**
 * Transform Rodalies line data to normalize color property.
 * Rodalies uses 'brand_color' which may need normalization (adding # prefix).
 */
function normalizeRodaliesData(data: LineGeometryCollection): MetroLineCollection {
  return {
    type: 'FeatureCollection',
    features: data.features.map((feature) => {
      const properties = feature.properties ?? {};
      const brandColor = properties.brand_color;

      // Normalize color: ensure it has # prefix
      let normalizedColor = brandColor;
      if (brandColor && !brandColor.startsWith('#')) {
        const hexPattern = /^[0-9a-f]{6}$/i;
        if (hexPattern.test(brandColor)) {
          normalizedColor = `#${brandColor}`;
        }
      }

      return {
        type: 'Feature' as const,
        properties: {
          ...properties,
          // Keep brand_color normalized for GenericLineLayer
          brand_color: normalizedColor ?? '#f97316',
          // Also provide 'color' for compatibility
          color: normalizedColor ?? '#f97316',
        },
        geometry: feature.geometry,
      };
    }),
  } as MetroLineCollection;
}

export function RodaliesLineLayer({
  map,
  visible = true,
  highlightedLines = [],
  isolateMode = false,
}: RodaliesLineLayerProps) {
  const loadData = useCallback(async () => {
    const data = await loadLineGeometryCollection();
    return normalizeRodaliesData(data);
  }, []);

  return (
    <GenericLineLayer
      map={map}
      loadData={loadData}
      config={RODALIES_LINE_CONFIG}
      visible={visible}
      highlightedLines={highlightedLines}
      isolateMode={isolateMode}
    />
  );
}
