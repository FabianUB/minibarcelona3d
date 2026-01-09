/**
 * FGCLineLayer Component
 * Feature: 006-metro-bus-integration
 *
 * Renders FGC (Ferrocarrils de la Generalitat de Catalunya) line geometries
 * as Mapbox GL layers. Supports all FGC lines (L6-L12, S1-S9, R5-R60).
 */

import { useEffect, useState } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { loadAllFgcLines } from '../../lib/metro/dataLoader';
import type { MetroLineCollection } from '../../types/metro';
import { useMapStyleReady } from '../../hooks/useMapStyleReady';

export interface FGCLineLayerProps {
  map: MapboxMap;
  visible?: boolean;
  /** Optional: highlight specific line codes (e.g., ['S1', 'S2', 'L6']) */
  highlightedLines?: string[];
  /** Optional: isolate mode dims non-highlighted lines */
  isolateMode?: boolean;
}

const SOURCE_ID = 'fgc-lines-source';
const LINE_LAYER_ID = 'fgc-lines';
const LINE_CASING_LAYER_ID = 'fgc-lines-casing';

export function FGCLineLayer({
  map,
  visible = true,
  highlightedLines = [],
  isolateMode = false,
}: FGCLineLayerProps) {
  const [geoJSON, setGeoJSON] = useState<MetroLineCollection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layersReady, setLayersReady] = useState(false);
  const styleReady = useMapStyleReady(map);

  // Load FGC line geometries
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await loadAllFgcLines();
        if (!cancelled) {
          setGeoJSON(data);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load FGC lines');
          setIsLoading(false);
        }
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, []);

  // Add source and layers when data is ready
  useEffect(() => {
    if (!map || !geoJSON || isLoading || error || !styleReady) return;

    try {
      // Check if source already exists
      if (map.getSource(SOURCE_ID)) {
        const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource;
        source.setData(geoJSON);
        return;
      }

      // Add source
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: geoJSON,
      });

      // Line casing (outer stroke for contrast)
      map.addLayer({
        id: LINE_CASING_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#ffffff',
          'line-width': [
            'interpolate',
            ['exponential', 1.5],
            ['zoom'],
            10, 3,
            13, 5,
            15, 8,
            18, 14,
          ],
          'line-opacity': 0, // Start hidden, visibility effect sets correct value
        },
      });

      // Main line layer
      map.addLayer({
        id: LINE_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': [
            'interpolate',
            ['exponential', 1.5],
            ['zoom'],
            10, 2,
            13, 3,
            15, 5,
            18, 10,
          ],
          'line-opacity': 0, // Start hidden, visibility effect sets correct value
        },
      });

      // Signal that layers are ready for visibility updates
      setLayersReady(true);

    } catch {
      // Layer addition failed
    }

    // Cleanup on unmount
    return () => {
      setLayersReady(false);
      if (!map.isStyleLoaded()) return;

      try {
        if (map.getLayer(LINE_LAYER_ID)) {
          map.removeLayer(LINE_LAYER_ID);
        }
        if (map.getLayer(LINE_CASING_LAYER_ID)) {
          map.removeLayer(LINE_CASING_LAYER_ID);
        }
        if (map.getSource(SOURCE_ID)) {
          map.removeSource(SOURCE_ID);
        }
      } catch {
        // Cleanup failed
      }
    };
  // Note: visible intentionally excluded - visibility handled by separate effect
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, geoJSON, isLoading, error, styleReady]);

  // Update visibility and highlighting
  useEffect(() => {
    if (!map || !layersReady) return;
    if (!map.getLayer(LINE_LAYER_ID) || !map.getLayer(LINE_CASING_LAYER_ID)) return;

    const hasHighlight = highlightedLines.length > 0;

    // Build opacity expression based on highlight state
    let lineOpacity: mapboxgl.Expression | number;
    let casingOpacity: mapboxgl.Expression | number;

    if (!visible) {
      lineOpacity = 0;
      casingOpacity = 0;
    } else if (hasHighlight && isolateMode) {
      // In isolate mode, dim non-highlighted lines
      lineOpacity = [
        'case',
        ['in', ['get', 'line_code'], ['literal', highlightedLines]],
        0.95,
        0.2,
      ];
      casingOpacity = [
        'case',
        ['in', ['get', 'line_code'], ['literal', highlightedLines]],
        0.8,
        0.1,
      ];
    } else if (hasHighlight) {
      // In highlight mode, all lines visible but highlighted are brighter
      lineOpacity = [
        'case',
        ['in', ['get', 'line_code'], ['literal', highlightedLines]],
        1.0,
        0.7,
      ];
      casingOpacity = 0.8;
    } else {
      lineOpacity = 0.9;
      casingOpacity = 0.8;
    }

    map.setPaintProperty(LINE_LAYER_ID, 'line-opacity', lineOpacity);
    map.setPaintProperty(LINE_CASING_LAYER_ID, 'line-opacity', casingOpacity);

    // Adjust line width for highlighted lines
    if (hasHighlight) {
      const isHighlighted: mapboxgl.Expression = ['in', ['get', 'line_code'], ['literal', highlightedLines]];
      const widthExpression: mapboxgl.Expression = [
        'interpolate',
        ['exponential', 1.5],
        ['zoom'],
        10, ['case', isHighlighted, 3, 2],
        13, ['case', isHighlighted, 5, 3],
        15, ['case', isHighlighted, 7, 5],
        18, ['case', isHighlighted, 14, 10],
      ];
      map.setPaintProperty(LINE_LAYER_ID, 'line-width', widthExpression);
    } else {
      map.setPaintProperty(LINE_LAYER_ID, 'line-width', [
        'interpolate',
        ['exponential', 1.5],
        ['zoom'],
        10, 2,
        13, 3,
        15, 5,
        18, 10,
      ]);
    }
  }, [map, visible, highlightedLines, isolateMode, layersReady]);

  return null;
}
