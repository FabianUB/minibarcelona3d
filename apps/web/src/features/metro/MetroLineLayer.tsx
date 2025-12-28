/**
 * MetroLineLayer Component
 * Feature: 006-metro-bus-integration
 *
 * Renders Barcelona Metro line geometries as Mapbox GL layers.
 * Each line is colored according to its official TMB color.
 */

import { useEffect, useState } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { loadAllMetroLines } from '../../lib/metro/dataLoader';
import type { MetroLineCollection } from '../../types/metro';

export interface MetroLineLayerProps {
  map: MapboxMap;
  visible?: boolean;
  /** Optional: highlight specific line codes (e.g., ['L1', 'L3']) */
  highlightedLines?: string[];
  /** Optional: isolate mode dims non-highlighted lines */
  isolateMode?: boolean;
}

const SOURCE_ID = 'metro-lines-source';
const LINE_LAYER_ID = 'metro-lines';
const LINE_CASING_LAYER_ID = 'metro-lines-casing';

export function MetroLineLayer({
  map,
  visible = true,
  highlightedLines = [],
  isolateMode = false,
}: MetroLineLayerProps) {
  const [geoJSON, setGeoJSON] = useState<MetroLineCollection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [styleReady, setStyleReady] = useState(false);

  // Wait for map style to be ready
  useEffect(() => {
    if (!map) return;

    const checkStyle = () => {
      if (map.isStyleLoaded()) {
        setStyleReady(true);
      }
    };

    // Check immediately
    checkStyle();

    // If not ready, poll until it is (style.load may have already fired)
    if (!map.isStyleLoaded()) {
      const interval = setInterval(() => {
        if (map.isStyleLoaded()) {
          setStyleReady(true);
          clearInterval(interval);
        }
      }, 50);

      // Also listen for events as backup
      map.on('style.load', checkStyle);
      map.on('idle', checkStyle);

      return () => {
        clearInterval(interval);
        map.off('style.load', checkStyle);
        map.off('idle', checkStyle);
      };
    }
  }, [map]);

  // Load Metro line geometries
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await loadAllMetroLines();
        if (!cancelled) {
          setGeoJSON(data);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load Metro lines');
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
          'line-opacity': visible ? 0.8 : 0,
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
          'line-opacity': visible ? 0.9 : 0,
        },
      });

    } catch {
      // Layer addition failed - source may have been removed
    }

    // Cleanup on unmount
    return () => {
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
        // Cleanup failed - map may have been removed
      }
    };
  }, [map, geoJSON, isLoading, error, visible, styleReady]);

  // Update visibility and highlighting
  useEffect(() => {
    if (!map || !map.isStyleLoaded()) return;
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
      const widthExpression: mapboxgl.Expression = [
        'case',
        ['in', ['get', 'line_code'], ['literal', highlightedLines]],
        [
          'interpolate',
          ['exponential', 1.5],
          ['zoom'],
          10, 3,
          13, 5,
          15, 7,
          18, 14,
        ],
        [
          'interpolate',
          ['exponential', 1.5],
          ['zoom'],
          10, 2,
          13, 3,
          15, 5,
          18, 10,
        ],
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
  }, [map, visible, highlightedLines, isolateMode]);

  return null;
}
